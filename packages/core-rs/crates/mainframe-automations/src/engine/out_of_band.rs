//! Out-of-band step failure: the one write shared by the two paths that fail
//! a parked step outside the walk — the agent settle path
//! (`agent_settle::fail_waiting_step`) and the deadline sweep
//! (`deadline::fail_step`). One body so the two cannot drift apart.

use crate::error::StoreError;
use crate::ports::{AutomationEvent, EventSink, to_run_summary};
use crate::store::{AutomationCheckpoint, RunStore, StepStatus};

use super::checkpoint::{fail_step_entry, recompute_wake_at};
use super::markers::fail_enclosing_branch;

/// What the caller must do once the failure is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AfterFailure {
    /// `keepGoing`, or another entry is still waiting: re-advance the run.
    Advance,
    /// Nothing else can settle the run: finalize it `failed`.
    FailRun,
}

/// The failing step as the caller resolved it from the checkpoint.
pub(super) struct FailingStep<'a> {
    pub run_id: &'a str,
    pub step_ref: &'a str,
    pub keep_going: bool,
    /// `(block_id, branch_ref_suffix)` of the nearest enclosing concurrent
    /// Repeat, if any.
    pub enclosing_branch: Option<(String, String)>,
}

/// Fails one step outside the walk and streams the transition (A6).
///
/// A step inside a concurrent branch bypasses `blocks_concurrent`'s own
/// driver here, so when `keepGoing` is false this is the only place that
/// branch's marker is ever written; without it the driver replays the
/// leaf's `Failed` entry, skips past it, and launders the branch into
/// `Succeeded`. `keepGoing: true` skips the marker on purpose, leaving the
/// driver free to walk the branch's remaining steps, matching sequential
/// `run_repeat`'s absorption of the same failure.
///
/// A run with an outstanding `Waiting` entry must never finalize
/// out-of-band, or it orphans whatever that entry is waiting on, so a
/// still-waiting sibling forces [`AfterFailure::Advance`] regardless of
/// `keepGoing`.
///
/// `Ok(None)` means cancel already finalized the run (A8): nothing to do.
pub(super) async fn fail_step_out_of_band(
    store: &RunStore,
    events: &dyn EventSink,
    step: FailingStep<'_>,
    error: &str,
) -> Result<Option<AfterFailure>, StoreError> {
    let FailingStep {
        run_id,
        step_ref,
        keep_going,
        enclosing_branch,
    } = step;
    let step_ref_owned = step_ref.to_string();
    let error_owned = error.to_string();
    let patched = store
        .patch_checkpoint(run_id, move |cp| {
            fail_step_entry(cp, &step_ref_owned, &error_owned);
            if !keep_going {
                fail_enclosing_branch(cp, &enclosing_branch, &error_owned);
            }
            // A sibling branch may still be waiting: recompute rather than
            // clobbering its deadline with None.
            recompute_wake_at(cp);
        })
        .await;
    let record = match patched {
        Ok(record) => record,
        Err(StoreError::TerminalRun { .. }) => return Ok(None),
        Err(err) => return Err(err),
    };
    events.emit(AutomationEvent::RunUpdated {
        run: to_run_summary(&record),
    });
    Ok(Some(
        if keep_going || has_waiting_entry(&record.checkpoint) {
            AfterFailure::Advance
        } else {
            AfterFailure::FailRun
        },
    ))
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
