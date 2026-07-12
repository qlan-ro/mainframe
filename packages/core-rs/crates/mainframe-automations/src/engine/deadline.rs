//! Deadline sweep + out-of-band step failure (T4.3, Node interpreter.ts
//! sweepDeadlines/failStep): a waiting ask_agent step whose `wakeAt` passed
//! fails with the deadline error; `keepGoing` decides whether the run
//! continues. The chat itself is NOT told to stop (Node parity — only the
//! automation stops waiting); its eventual completion finds a non-waiting
//! entry and is dropped by the settle guard.

use crate::domain::{Step, find_step_by_id};
use crate::error::StoreError;
use crate::store::{RunRecord, StepStatus, TerminalStatus};

use super::advance::Interpreter;
use super::checkpoint::fail_step_entry;

const AGENT_DEADLINE_ERROR: &str = "agent step deadline exceeded";

impl Interpreter {
    /// Driven by the 30 s sweep (T8/T10): fail every live run whose wakeAt
    /// deadline has passed. ask_me waits carry `wakeAt: null` by design and
    /// are never swept (no expiry — contract §9).
    pub async fn sweep_deadlines(&self, now: i64) -> Result<(), StoreError> {
        let due = self
            .deps
            .store
            .list_live_runs()
            .await?
            .into_iter()
            .filter(|run| run.checkpoint.wake_at.is_some_and(|wake_at| wake_at <= now));
        for run in due {
            self.fail_deadline_step(&run).await?;
        }
        Ok(())
    }

    /// Fails one step outside the walk, applying the same keepGoing policy
    /// the engine uses everywhere: without it the run finalizes here, since
    /// a later advance() skips `failed` entries without consulting keepGoing.
    pub async fn fail_step(
        &self,
        run_id: &str,
        step_ref: &str,
        error: &str,
    ) -> Result<(), StoreError> {
        let Some(run) = self.deps.store.get_run(run_id).await? else {
            return Ok(());
        };
        let step =
            run.checkpoint.steps.get(step_ref).and_then(|entry| {
                find_step_by_id(&run.checkpoint.definition.steps, &entry.step_id)
            });

        let step_ref_owned = step_ref.to_string();
        let error_owned = error.to_string();
        let patched = self
            .deps
            .store
            .patch_checkpoint(run_id, move |cp| {
                fail_step_entry(cp, &step_ref_owned, &error_owned);
                cp.wake_at = None;
            })
            .await;
        match patched {
            Ok(_) => {}
            Err(StoreError::TerminalRun { .. }) => return Ok(()),
            Err(err) => return Err(err),
        }

        if step.is_some_and(Step::keep_going) {
            self.advance(run_id).await
        } else {
            self.finalize_and_emit(run_id, TerminalStatus::Failed, Some(error.to_string()))
                .await
        }
    }

    async fn fail_deadline_step(&self, run: &RunRecord) -> Result<(), StoreError> {
        let waiting = run
            .checkpoint
            .steps
            .iter()
            .find(|(_, entry)| entry.status == StepStatus::Waiting);
        let Some((step_ref, entry)) = waiting else {
            return Ok(());
        };
        if entry.kind != "ask_agent" {
            return Ok(());
        }
        self.fail_step(&run.id, step_ref, AGENT_DEADLINE_ERROR)
            .await
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T4.3), not a TS port
// confidence: high
// todos: 0
// notes: error string mirrors Node's AGENT_DEADLINE_ERROR; fail_step doubles
//        as the boot reconciler's out-of-band failure hook (T10.1).
