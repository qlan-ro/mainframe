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

use crate::domain::{Step, find_step_by_id};
use crate::error::StoreError;
use crate::store::{RunRecord, StepStatus, TerminalStatus, epoch_ms_now};

use super::advance::Interpreter;
use super::checkpoint::fail_step_entry;

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
            self.resolve_due_step(&run).await?;
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

    async fn resolve_due_step(self: &Arc<Self>, run: &RunRecord) -> Result<(), StoreError> {
        let waiting = run
            .checkpoint
            .steps
            .iter()
            .find(|(_, entry)| entry.status == StepStatus::Waiting);
        let Some((step_ref, entry)) = waiting else {
            return Ok(());
        };
        match entry.kind.as_str() {
            "ask_agent" => {
                self.fail_step(&run.id, step_ref, AGENT_DEADLINE_ERROR)
                    .await
            }
            "wait" => self.resume_wait(&run.id, step_ref).await,
            _ => Ok(()),
        }
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
                }
                cp.wake_at = None;
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

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T4.3), not a TS port
// confidence: high
// todos: 0
// notes: error string mirrors Node's AGENT_DEADLINE_ERROR; fail_step doubles
//        as the boot reconciler's out-of-band failure hook (T10.1).
