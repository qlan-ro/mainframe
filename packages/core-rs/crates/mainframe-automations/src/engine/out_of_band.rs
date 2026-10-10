//! Out-of-band settlement: the one path that settles a parked step outside
//! the walk. The agent settle path (`agent_settle`) and the deadline sweep
//! (`deadline`) both go through `Interpreter::settle_out_of_band`, so the
//! success and failure writes, the branch marker and the `RunUpdated` emit
//! cannot drift apart.
//!
//! A cancel or a competing settle can win between the read and the write.
//! Every write re-checks the entry inside the checkpoint transaction and
//! changes nothing unless it is still `waiting`; a run that cancel already
//! finalized surfaces as `StoreError::TerminalRun` (A8). Either way the loser
//! neither emits nor advances.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{Map, Value};

use crate::domain::{Step, enclosing_concurrent_branch, find_step_by_id};
use crate::error::StoreError;
use crate::store::{AutomationCheckpoint, RunRecord, RunStore, StepStatus, TerminalStatus};

use super::OutOfBandOutcome;
use super::advance::Interpreter;
use super::markers::fail_enclosing_branch;

impl Interpreter {
    /// Settles the parked `step_ref` with `outcome`, streams the transition
    /// (A6) and moves the run on. A no-op when the run is gone or terminal,
    /// or the entry is no longer `waiting`.
    pub(crate) async fn settle_out_of_band(
        &self,
        run_id: &str,
        step_ref: &str,
        outcome: OutOfBandOutcome,
    ) -> Result<(), StoreError> {
        let Some(run) = self.deps.store.get_run(run_id).await? else {
            return Ok(());
        };
        if run.status.is_terminal() || !is_waiting(&run.checkpoint, step_ref) {
            return Ok(());
        }
        match outcome {
            OutOfBandOutcome::Succeeded(outputs) => {
                self.settle_success(run_id, step_ref, outputs).await
            }
            OutOfBandOutcome::Failed(error) => self.settle_failure(&run, step_ref, error).await,
        }
    }

    async fn settle_success(
        &self,
        run_id: &str,
        step_ref: &str,
        outputs: Map<String, Value>,
    ) -> Result<(), StoreError> {
        let step_ref = step_ref.to_string();
        let settled = patch_if_changed(&self.deps.store, run_id, move |cp| {
            cp.succeed_waiting_step(&step_ref, Some(outputs))
        })
        .await?;
        let Some(record) = settled else {
            return Ok(());
        };
        self.emit(&record);
        self.advance(run_id).await
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
        run: &RunRecord,
        step_ref: &str,
        error: String,
    ) -> Result<(), StoreError> {
        let (keep_going, enclosing_branch) = failure_policy(run, step_ref);
        let (step_ref_owned, error_owned) = (step_ref.to_string(), error.clone());
        let settled = patch_if_changed(&self.deps.store, &run.id, move |cp| {
            if !is_waiting(cp, &step_ref_owned) {
                return false;
            }
            cp.fail_step_entry(&step_ref_owned, &error_owned);
            if !keep_going {
                fail_enclosing_branch(cp, &enclosing_branch, &error_owned);
            }
            // A sibling branch may still be waiting: recompute rather than
            // clobbering its deadline with None.
            cp.recompute_wake_at();
            true
        })
        .await?;
        let Some(record) = settled else {
            return Ok(());
        };
        self.emit(&record);
        if keep_going || has_waiting_entry(&record.checkpoint) {
            self.advance(&run.id).await
        } else {
            self.finalize_and_emit(&run.id, TerminalStatus::Failed, Some(error))
                .await
        }
    }
}

/// Applies `transition` inside the checkpoint transaction and returns the
/// updated run only if the transition reports a change. `None` means the
/// run was already terminal (cancel won, A8) or the entry had moved on.
pub(super) async fn patch_if_changed(
    store: &RunStore,
    run_id: &str,
    transition: impl FnOnce(&mut AutomationCheckpoint) -> bool + Send + 'static,
) -> Result<Option<RunRecord>, StoreError> {
    let changed = Arc::new(AtomicBool::new(false));
    let changed_in_write = Arc::clone(&changed);
    let patched = store
        .patch_checkpoint(run_id, move |cp| {
            changed_in_write.store(transition(cp), Ordering::Relaxed);
        })
        .await;
    match patched {
        Ok(record) => Ok(changed.load(Ordering::Relaxed).then_some(record)),
        Err(StoreError::TerminalRun { .. }) => Ok(None),
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
fn failure_policy(run: &RunRecord, step_ref: &str) -> (bool, Option<(String, String)>) {
    let Some(entry) = run.checkpoint.steps.get(step_ref) else {
        return (false, None);
    };
    let steps = &run.checkpoint.definition.steps;
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
