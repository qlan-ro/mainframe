//! Due-sweep. One `wakeAt` carries two meanings, discriminated by the parked
//! step's kind:
//!
//! - `ask_agent` — a deadline. The step fails out-of-band with the deadline
//!   error and `keepGoing` decides whether the run continues. The chat itself
//!   is NOT told to stop (only the automation stops waiting); its eventual
//!   completion finds a non-waiting entry and is dropped by the settle guard.
//! - `wait` — a resume. The step succeeds and the run advances.
//!
//! Any other parked kind (`ask_me`, which parks with `wakeAt: null`) is never
//! due and is left alone.

use std::sync::Arc;
use std::time::Duration;

use crate::error::StoreError;
use crate::store::{AutomationCheckpoint, RunRecord, StepKind, StepStatus, epoch_ms_now};

use super::advance::Interpreter;
use super::out_of_band::patch_if_changed;
use super::{OutOfBandOutcome, SettleError};

const AGENT_DEADLINE_ERROR: &str = "agent step deadline exceeded";

/// Matches the schedule sweep's cadence — one 30 s heartbeat is enough for
/// both, and a second interval would only add jitter.
pub const DUE_SWEEP_INTERVAL: Duration = Duration::from_secs(30);

impl Interpreter {
    /// Driven by the 30 s sweep: resolve every live run whose wakeAt
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
    pub(crate) fn spawn_due_sweep(self: Arc<Self>) -> tokio::task::JoinHandle<()> {
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

    /// Every waiting entry whose OWN deadline is due (N branches can be
    /// parked at once, each with an independent deadline).
    async fn resolve_due_step(
        self: &Arc<Self>,
        run: &RunRecord,
        now: i64,
    ) -> Result<(), StoreError> {
        for (step_ref, kind) in due_waiting_entries(&run.checkpoint, now) {
            match kind {
                StepKind::AskAgent => {
                    let error = OutOfBandOutcome::Failed(AGENT_DEADLINE_ERROR.to_string());
                    self.settle_out_of_band(&run.id, &step_ref, error)
                        .await
                        .map_err(SettleError::into_store_error)?
                }
                StepKind::Wait => self.resume_wait(&run.id, &step_ref).await?,
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
        let settled = patch_if_changed(&self.deps.store, run_id, move |cp| {
            cp.succeed_waiting_step(&step_ref_owned, None)
        })
        .await?;
        // Cancel raced the wake, or the entry already settled.
        if settled.is_none() {
            return Ok(());
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

/// Every currently-waiting entry whose own deadline has passed.
fn due_waiting_entries(checkpoint: &AutomationCheckpoint, now: i64) -> Vec<(String, StepKind)> {
    let mut due: Vec<(String, StepKind)> = checkpoint
        .steps
        .iter()
        .filter(|(_, entry)| entry.status == StepStatus::Waiting)
        .filter(|(_, entry)| entry.wake_at.is_some_and(|wake_at| wake_at <= now))
        .map(|(step_ref, entry)| (step_ref.clone(), entry.kind.clone()))
        .collect();
    // Migration: a checkpoint parked before per-entry wake_at existed carries
    // its deadline only at the run level. Fall back to the run-level
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
