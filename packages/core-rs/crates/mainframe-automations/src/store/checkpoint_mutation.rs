//! Checkpoint entry transitions. Every verb, block driver and out-of-band
//! settle path writes entries through these methods inside a
//! `RunStore::patch_checkpoint` closure, so the preservation rules below hold
//! for all of them.

use serde_json::{Map, Value};

use super::{AutomationCheckpoint, CheckpointStep, StepKind, StepStatus, epoch_ms_now};

impl AutomationCheckpoint {
    /// Writes one stepRef entry. `outputs` land only on `succeeded` (a failed
    /// re-run must not clobber earlier outputs); `startedAt` survives
    /// transitions; `chatId`/`interactionId` are preserved, because the
    /// running-to-waiting rewrite must not drop what a verb stamped between
    /// commits. `wake_at` is the caller's to set explicitly (only `park_step`
    /// and the agent verb pass one); every other transition clears it.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn set_step(
        &mut self,
        step_ref: &str,
        step_id: &str,
        kind: StepKind,
        status: StepStatus,
        outputs: Option<Map<String, Value>>,
        error: Option<String>,
        wake_at: Option<i64>,
    ) {
        let now = epoch_ms_now();
        let existing = self.steps.get(step_ref);
        let terminal = matches!(
            status,
            StepStatus::Succeeded | StepStatus::Failed | StepStatus::Skipped
        );
        let entry = CheckpointStep {
            step_id: step_id.to_string(),
            kind,
            status,
            outputs: if status == StepStatus::Succeeded {
                outputs
            } else {
                existing.and_then(|entry| entry.outputs.clone())
            },
            error,
            started_at: existing.and_then(|entry| entry.started_at).or(Some(now)),
            finished_at: terminal.then_some(now),
            chat_id: existing.and_then(|entry| entry.chat_id.clone()),
            interaction_id: existing.and_then(|entry| entry.interaction_id.clone()),
            wake_at,
        };
        self.steps.insert(step_ref.to_string(), entry);
    }

    /// The walk's wait commit. A verb may park AND settle its entry before
    /// the walk's own commit runs (a fast agent completion), so a terminal
    /// entry is never re-parked nor its `wake_at` re-armed. `walk_frame`
    /// returns `Parked` for an entry that is already `Waiting` without
    /// dispatching, so this only sees a step entering `Waiting` for the first
    /// time, carrying dispatch's freshly computed `wake_at`.
    pub(crate) fn park_step(
        &mut self,
        step_ref: &str,
        step_id: &str,
        kind: StepKind,
        wake_at: Option<i64>,
    ) {
        let settled = self.steps.get(step_ref).is_some_and(|entry| {
            matches!(
                entry.status,
                StepStatus::Succeeded | StepStatus::Failed | StepStatus::Skipped
            )
        });
        if settled {
            return;
        }
        self.set_step(
            step_ref,
            step_id,
            kind,
            StepStatus::Waiting,
            None,
            None,
            wake_at,
        );
        self.recompute_wake_at();
    }

    /// Fails an EXISTING entry in place (the stale-`running` restart policy
    /// and out-of-band failures). Unlike `set_step`, a missing entry stays
    /// missing.
    pub(crate) fn fail_step_entry(&mut self, step_ref: &str, error: &str) {
        if let Some(entry) = self.steps.get_mut(step_ref) {
            entry.status = StepStatus::Failed;
            entry.error = Some(error.to_string());
            entry.finished_at = Some(epoch_ms_now());
            entry.wake_at = None;
        }
    }

    /// The run-level `wake_at` is only the deadline sweep's cheap pre-filter,
    /// recomputed as the minimum over every still-`waiting` entry so N
    /// concurrent parks each keep their own deadline instead of one clobbering
    /// the others.
    pub(crate) fn recompute_wake_at(&mut self) {
        self.wake_at = self
            .steps
            .values()
            .filter(|entry| entry.status == StepStatus::Waiting)
            .filter_map(|entry| entry.wake_at)
            .min();
    }

    /// Settles a `waiting` entry as succeeded with `outputs` and recomputes
    /// the run-level `wake_at`. Returns false, writing nothing, when the entry
    /// is missing or no longer waiting: a cancel or a competing settle got
    /// there first.
    pub(crate) fn succeed_waiting_step(
        &mut self,
        step_ref: &str,
        outputs: Option<Map<String, Value>>,
    ) -> bool {
        let Some(entry) = self.steps.get_mut(step_ref) else {
            return false;
        };
        if entry.status != StepStatus::Waiting {
            return false;
        }
        entry.status = StepStatus::Succeeded;
        entry.outputs = outputs;
        entry.error = None;
        entry.finished_at = Some(epoch_ms_now());
        entry.wake_at = None;
        self.recompute_wake_at();
        true
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Map, Value, json};

    use super::super::test_support::step_entry;
    use super::super::{AutomationCheckpoint, RunTriggerContext, StepKind, StepStatus};
    use crate::domain::AutomationDefinition;

    fn checkpoint() -> AutomationCheckpoint {
        AutomationCheckpoint::new(
            AutomationDefinition {
                triggers: vec![],
                steps: vec![],
            },
            RunTriggerContext::manual(),
        )
    }

    fn waiting(wake_at: Option<i64>) -> super::super::CheckpointStep {
        let mut entry = step_entry("agent", StepStatus::Waiting);
        entry.kind = StepKind::AskAgent;
        entry.wake_at = wake_at;
        entry
    }

    fn outputs(value: &str) -> Map<String, Value> {
        Map::from_iter([("result".to_string(), json!(value))])
    }

    #[test]
    fn succeeding_a_waiting_entry_keeps_the_sibling_deadline() {
        let mut cp = checkpoint();
        cp.steps.insert("a".into(), waiting(Some(500)));
        cp.steps.insert("b".into(), waiting(Some(900)));
        cp.wake_at = Some(500);

        assert!(cp.succeed_waiting_step("a", Some(outputs("done"))));

        let entry = &cp.steps["a"];
        assert_eq!(entry.status, StepStatus::Succeeded);
        assert_eq!(entry.outputs, Some(outputs("done")));
        assert_eq!(entry.wake_at, None);
        assert!(entry.finished_at.is_some());
        assert_eq!(cp.wake_at, Some(900));
    }

    #[test]
    fn a_settled_or_missing_entry_is_not_settled_again() {
        let mut cp = checkpoint();
        let mut settled = waiting(None);
        settled.status = StepStatus::Failed;
        settled.error = Some("deadline".into());
        cp.steps.insert("a".into(), settled);

        assert!(!cp.succeed_waiting_step("a", Some(outputs("late"))));
        assert!(!cp.succeed_waiting_step("missing", None));

        let entry = &cp.steps["a"];
        assert_eq!(entry.status, StepStatus::Failed);
        assert_eq!(entry.error.as_deref(), Some("deadline"));
        assert_eq!(entry.outputs, None);
        assert!(!cp.steps.contains_key("missing"));
    }

    #[test]
    fn parking_never_reopens_a_terminal_entry() {
        let mut cp = checkpoint();
        let mut done = waiting(None);
        done.status = StepStatus::Succeeded;
        cp.steps.insert("a".into(), done);

        cp.park_step("a", "agent", StepKind::AskAgent, Some(700));

        assert_eq!(cp.steps["a"].status, StepStatus::Succeeded);
        assert_eq!(cp.steps["a"].wake_at, None);
        assert_eq!(cp.wake_at, None);
    }
}
