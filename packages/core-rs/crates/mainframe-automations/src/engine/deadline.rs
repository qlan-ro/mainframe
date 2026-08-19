//! Due-sweep + out-of-band step failure (T4.3, Node interpreter.ts
//! sweepDeadlines/failStep). One `wakeAt` carries two meanings, discriminated
//! by the parked step's kind:
//!
//! - `ask_agent` — a deadline. The step fails with the deadline error and
//!   `keepGoing` decides whether the run continues. The chat itself is NOT
//!   told to stop (Node parity — only the automation stops waiting); its
//!   eventual completion finds a non-waiting entry and is dropped by the
//!   settle guard.
//! - `wait` — a resume. The step succeeds and the run advances.
//!
//! Any other parked kind (`ask_me`, which parks with `wakeAt: null`) is never
//! due and is left alone.

use std::sync::Arc;
use std::time::Duration;

use crate::domain::{Step, enclosing_concurrent_branch, find_step_by_id};
use crate::error::StoreError;
use crate::store::{AutomationCheckpoint, RunRecord, StepStatus, TerminalStatus, epoch_ms_now};

use super::advance::Interpreter;
use super::checkpoint::{fail_step_entry, has_waiting_entry, recompute_wake_at};
use super::markers::fail_enclosing_branch;

const AGENT_DEADLINE_ERROR: &str = "agent step deadline exceeded";

/// Matches the schedule sweep's cadence — one 30 s heartbeat is enough for
/// both, and a second interval would only add jitter.
pub const DUE_SWEEP_INTERVAL: Duration = Duration::from_secs(30);

impl Interpreter {
    /// Driven by the 30 s sweep (T8/T10): resolve every live run whose wakeAt
    /// has passed. ask_me waits carry `wakeAt: null` by design and are never
    /// swept (no expiry — contract §9).
    ///
    /// The sweep interval is also the resolution of a `wait`: a wait resumes
    /// on the first sweep at or after its wakeAt, so short waits round up.
    pub async fn sweep_due(self: &Arc<Self>, now: i64) -> Result<(), StoreError> {
        let due = self
            .deps
            .store
            .list_live_runs()
            .await?
            .into_iter()
            .filter(|run| run.checkpoint.wake_at.is_some_and(|wake_at| wake_at <= now));
        for run in due {
            self.resolve_due_step(&run, now).await?;
        }
        Ok(())
    }

    /// The 30 s driver, armed by `AutomationsEngine::start`. Without this the
    /// `wakeAt` column is inert: agent deadlines never fire and a `wait` step
    /// parks forever.
    pub fn spawn_due_sweep(self: Arc<Self>) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(DUE_SWEEP_INTERVAL);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                interval.tick().await;
                if let Err(err) = self.sweep_due(epoch_ms_now()).await {
                    // One bad sweep must not kill the driver for every run.
                    tracing::error!(error = %err, "automations due-sweep failed");
                }
            }
        })
    }

    /// Fails one step outside the walk, applying the same keepGoing policy
    /// the engine uses everywhere: without it the run finalizes here, since
    /// a later advance() skips `failed` entries without consulting keepGoing.
    ///
    /// Extended for Phase 4a concurrency (MUST-FIX 3), identically to
    /// `agent_settle::fail_waiting_step`: a step inside a concurrent branch
    /// needs that branch's own marker written here too, or the driver
    /// launders it into `Succeeded` on replay — unless `keepGoing` is true,
    /// in which case skipping the marker IS the correct behavior (same
    /// reasoning as `fail_waiting_step`). A run with an outstanding
    /// `Waiting` entry must never finalize out-of-band, so a still-waiting
    /// sibling forces `advance()` regardless of `keepGoing`.
    pub async fn fail_step(
        &self,
        run_id: &str,
        step_ref: &str,
        error: &str,
    ) -> Result<(), StoreError> {
        let Some(run) = self.deps.store.get_run(run_id).await? else {
            return Ok(());
        };
        let (step, enclosing_branch) = lookup_failing_step(&run, step_ref);
        let step_keep_going = step.is_some_and(Step::keep_going);

        let step_ref_owned = step_ref.to_string();
        let error_owned = error.to_string();
        let patched = self
            .deps
            .store
            .patch_checkpoint(run_id, move |cp| {
                fail_step_entry(cp, &step_ref_owned, &error_owned);
                if !step_keep_going {
                    fail_enclosing_branch(cp, &enclosing_branch, &error_owned);
                }
                // A sibling branch may still be waiting — recompute rather
                // than clobbering its deadline with None.
                recompute_wake_at(cp);
            })
            .await;
        let record = match patched {
            Ok(record) => record,
            Err(StoreError::TerminalRun { .. }) => return Ok(()),
            Err(err) => return Err(err),
        };

        if step.is_some_and(Step::keep_going) || has_waiting_entry(&record.checkpoint) {
            self.advance(run_id).await
        } else {
            self.finalize_and_emit(run_id, TerminalStatus::Failed, Some(error.to_string()))
                .await
        }
    }

    /// Every waiting entry whose OWN deadline is due (Phase 4a: N branches can
    /// now be parked at once, each with an independent deadline).
    async fn resolve_due_step(
        self: &Arc<Self>,
        run: &RunRecord,
        now: i64,
    ) -> Result<(), StoreError> {
        for (step_ref, kind) in due_waiting_entries(&run.checkpoint, now) {
            match kind.as_str() {
                "ask_agent" => {
                    self.fail_step(&run.id, &step_ref, AGENT_DEADLINE_ERROR)
                        .await?
                }
                "wait" => self.resume_wait(&run.id, &step_ref).await?,
                _ => {}
            }
        }
        Ok(())
    }

    /// Settles a due `wait` and resumes the walk. Mirrors `apply_answers`:
    /// the parked entry becomes `succeeded` in place, carrying no outputs —
    /// a wait produces no tokens.
    async fn resume_wait(self: &Arc<Self>, run_id: &str, step_ref: &str) -> Result<(), StoreError> {
        let step_ref_owned = step_ref.to_string();
        let now = epoch_ms_now();
        let patched = self
            .deps
            .store
            .patch_checkpoint(run_id, move |cp| {
                if let Some(entry) = cp.steps.get_mut(&step_ref_owned) {
                    entry.status = StepStatus::Succeeded;
                    entry.finished_at = Some(now);
                    entry.wake_at = None;
                }
                // A sibling branch may still be waiting — recompute rather
                // than clobbering its deadline with None.
                recompute_wake_at(cp);
            })
            .await;
        match patched {
            Ok(_) => {}
            // Cancel raced the wake — the run is already terminal.
            Err(StoreError::TerminalRun { .. }) => return Ok(()),
            Err(err) => return Err(err),
        }

        // No emit here: A6 is already satisfied downstream. `advance` emits the
        // whole run record on every park and terminal, and that payload carries
        // the checkpoint this resume just settled — so the run view sees the
        // transition on the next park without a second, identical event.
        //
        // Detached: `advance` runs to the next park or terminal, which can be a
        // multi-minute step. Awaiting it here would stall every other due run
        // behind this one and push out the sweep's own tick. `run_manually`
        // spawns its advance for the same reason.
        let interpreter = Arc::clone(self);
        let run_id = run_id.to_string();
        tokio::spawn(async move {
            if let Err(err) = interpreter.advance(&run_id).await {
                tracing::error!(run_id, error = %err, "wait resume: advance failed");
            }
        });
        Ok(())
    }
}

/// The failing step itself (for its `keepGoing`) plus, if it lives inside a
/// concurrent branch, that branch's own `(block_id, ref_suffix)` — shared
/// lookup for `fail_step`.
fn lookup_failing_step<'a>(
    run: &'a RunRecord,
    step_ref: &str,
) -> (Option<&'a Step>, Option<(String, String)>) {
    let Some(entry) = run.checkpoint.steps.get(step_ref) else {
        return (None, None);
    };
    let step = find_step_by_id(&run.checkpoint.definition.steps, &entry.step_id);
    let ref_suffix = step_ref
        .strip_prefix(entry.step_id.as_str())
        .unwrap_or_default();
    let enclosing_branch =
        enclosing_concurrent_branch(&run.checkpoint.definition.steps, &entry.step_id, ref_suffix);
    (step, enclosing_branch)
}

/// Every currently-waiting entry whose own deadline has passed.
fn due_waiting_entries(checkpoint: &AutomationCheckpoint, now: i64) -> Vec<(String, String)> {
    let mut due: Vec<(String, String)> = checkpoint
        .steps
        .iter()
        .filter(|(_, entry)| entry.status == StepStatus::Waiting)
        .filter(|(_, entry)| entry.wake_at.is_some_and(|wake_at| wake_at <= now))
        .map(|(step_ref, entry)| (step_ref.clone(), entry.kind.clone()))
        .collect();
    // Migration: a checkpoint parked before per-entry wake_at existed carries
    // its deadline only at the run level. Fall back to the pre-Phase-4a
    // single-park resolution so an in-flight run from before the upgrade
    // does not wedge — this run-level field can only be due here for an
    // entry that predates the per-entry one, since every write path since
    // recomputes it from entry-level fields alone.
    if due.is_empty() && checkpoint.wake_at.is_some_and(|wake_at| wake_at <= now) {
        due.extend(
            checkpoint
                .steps
                .iter()
                .find(|(_, entry)| entry.status == StepStatus::Waiting && entry.wake_at.is_none())
                .map(|(step_ref, entry)| (step_ref.clone(), entry.kind.clone())),
        );
    }
    due
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T4.3), not a TS port
// confidence: high
// todos: 0
// notes: error string mirrors Node's AGENT_DEADLINE_ERROR; fail_step doubles
//        as the boot reconciler's out-of-band failure hook (T10.1).
