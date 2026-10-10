//! Out-of-band settlement: the one path that settles a parked step outside
//! the walk. The agent settle path (`agent_settle`) and the deadline sweep
//! (`deadline`) both go through `Interpreter::settle_out_of_band`, so the
//! success and failure writes, the branch marker and the `RunUpdated` emit
//! cannot drift apart.
//!
//! A cancel or a competing settle can win between the caller's read and the
//! write. The waiting check, the keepGoing policy and the enclosing branch
//! are all read inside the checkpoint transaction, and the write changes
//! nothing unless the entry is still `waiting`; a run that cancel already
//! finalized surfaces as `StoreError::TerminalRun` (A8). Either way the loser
//! neither writes, emits nor advances.

use serde_json::{Map, Value};

use crate::domain::{Step, enclosing_concurrent_branch, find_step_by_id};
use crate::error::StoreError;
use crate::store::{AutomationCheckpoint, RunRecord, RunStore, StepStatus, TerminalStatus};

use super::OutOfBandOutcome;
use super::advance::Interpreter;
use super::markers::fail_enclosing_branch;

/// Which stage of an out-of-band settle failed, so callers can tell a lost
/// write from a failed follow-up.
#[derive(Debug, thiserror::Error)]
pub(crate) enum SettleError {
    /// The checkpoint write itself failed.
    #[error("settle write failed")]
    Write(#[source] StoreError),
    /// The outcome was written but re-advancing the run failed.
    #[error("advance after settle failed")]
    Advance(#[source] StoreError),
    /// The failure was written but finalizing the run failed.
    #[error("run finalize after settle failed")]
    Finalize(#[source] StoreError),
}

impl SettleError {
    pub(crate) fn into_store_error(self) -> StoreError {
        match self {
            Self::Write(err) | Self::Advance(err) | Self::Finalize(err) => err,
        }
    }
}

impl Interpreter {
    /// Settles the parked `step_ref` with `outcome`, streams the transition
    /// (A6) and moves the run on. A no-op when the run is gone or terminal,
    /// or the entry is no longer `waiting`.
    pub(crate) async fn settle_out_of_band(
        &self,
        run_id: &str,
        step_ref: &str,
        outcome: OutOfBandOutcome,
    ) -> Result<(), SettleError> {
        match outcome {
            OutOfBandOutcome::Succeeded(outputs) => {
                self.settle_success(run_id, step_ref, outputs).await
            }
            OutOfBandOutcome::Failed(error) => self.settle_failure(run_id, step_ref, error).await,
        }
    }

    async fn settle_success(
        &self,
        run_id: &str,
        step_ref: &str,
        outputs: Map<String, Value>,
    ) -> Result<(), SettleError> {
        let step_ref = step_ref.to_string();
        let settled = patch_if_changed(&self.deps.store, run_id, move |cp| {
            cp.succeed_waiting_step(&step_ref, Some(outputs))
        })
        .await
        .map_err(SettleError::Write)?;
        let Some(record) = settled else {
            return Ok(());
        };
        self.emit(&record);
        self.advance(run_id).await.map_err(SettleError::Advance)
    }

    /// Fails the step with the keepGoing policy the walk applies: without
    /// keepGoing the run finalizes here, since a later advance skips `failed`
    /// entries without consulting it.
    ///
    /// A step inside a concurrent branch bypasses `blocks_concurrent`'s
    /// driver, so when keepGoing is false this is the only place that
    /// branch's marker is written; without it the driver replays the leaf's
    /// `Failed` entry, skips past it, and launders the branch into
    /// `Succeeded`. keepGoing skips the marker on purpose, leaving the driver
    /// free to walk the branch's remaining steps, as sequential `run_repeat`
    /// absorbs the same failure.
    ///
    /// A run with another `waiting` entry must never finalize out-of-band, or
    /// it orphans whatever that entry waits on, so a still-waiting sibling
    /// forces an advance regardless of keepGoing.
    async fn settle_failure(
        &self,
        run_id: &str,
        step_ref: &str,
        error: String,
    ) -> Result<(), SettleError> {
        let (step_ref_owned, error_owned) = (step_ref.to_string(), error.clone());
        let settled = patch_if_changed(&self.deps.store, run_id, move |cp| {
            if !is_waiting(cp, &step_ref_owned) {
                return false;
            }
            let (keep_going, enclosing_branch) = failure_policy(cp, &step_ref_owned);
            cp.fail_step_entry(&step_ref_owned, &error_owned);
            if !keep_going {
                fail_enclosing_branch(cp, &enclosing_branch, &error_owned);
            }
            // A sibling branch may still be waiting: recompute rather than
            // clobbering its deadline with None.
            cp.recompute_wake_at();
            true
        })
        .await
        .map_err(SettleError::Write)?;
        let Some(record) = settled else {
            return Ok(());
        };
        self.emit(&record);
        // The definition is frozen in the checkpoint, so the policy read
        // back from the written record is the one the write applied.
        let (keep_going, _) = failure_policy(&record.checkpoint, step_ref);
        if keep_going || has_waiting_entry(&record.checkpoint) {
            self.advance(run_id).await.map_err(SettleError::Advance)
        } else {
            self.finalize_and_emit(run_id, TerminalStatus::Failed, Some(error))
                .await
                .map_err(SettleError::Finalize)
        }
    }
}

/// Applies `transition` inside the checkpoint transaction and returns the
/// updated run only if the transition reports a change; a transition that
/// returns false writes nothing. `None` also means the run is gone or was
/// already terminal (cancel won, A8).
pub(super) async fn patch_if_changed(
    store: &RunStore,
    run_id: &str,
    transition: impl FnOnce(&mut AutomationCheckpoint) -> bool + Send + 'static,
) -> Result<Option<RunRecord>, StoreError> {
    match store.patch_checkpoint_if(run_id, transition).await {
        Ok(record) => Ok(record),
        Err(StoreError::TerminalRun { .. } | StoreError::NotFound { .. }) => Ok(None),
        Err(err) => Err(err),
    }
}

fn is_waiting(checkpoint: &AutomationCheckpoint, step_ref: &str) -> bool {
    checkpoint
        .steps
        .get(step_ref)
        .is_some_and(|entry| entry.status == StepStatus::Waiting)
}

/// The failing step's keepGoing plus, if it lives inside a concurrent
/// branch, that branch's `(block_id, ref_suffix)`.
fn failure_policy(
    checkpoint: &AutomationCheckpoint,
    step_ref: &str,
) -> (bool, Option<(String, String)>) {
    let Some(entry) = checkpoint.steps.get(step_ref) else {
        return (false, None);
    };
    let steps = &checkpoint.definition.steps;
    let keep_going = find_step_by_id(steps, &entry.step_id).is_some_and(Step::keep_going);
    let ref_suffix = step_ref
        .strip_prefix(entry.step_id.as_str())
        .unwrap_or_default();
    let branch = enclosing_concurrent_branch(steps, &entry.step_id, ref_suffix);
    (keep_going, branch)
}

/// True while some entry is still `waiting`. Consulted AFTER the failure is
/// written, so the entry that just failed never counts: what remains (a
/// concurrent sibling, most often) is left to settle on its own and the
/// driver owns the eventual verdict.
fn has_waiting_entry(checkpoint: &AutomationCheckpoint) -> bool {
    checkpoint
        .steps
        .values()
        .any(|entry| entry.status == StepStatus::Waiting)
}
