//! Concurrent branch driver (Phase 4a). `walk_frame` used to return on the
//! first `Parked`, which made starting N agents at once impossible — agent 1
//! parks and the walk stops before agent 2 ever starts. This module runs a
//! list of branches within one checkpoint instead; `blocks_concurrent_repeat`
//! is the only caller today, deciding WHICH branches make up that list.

use crate::domain::Step;
use crate::error::StoreError;
use crate::store::{AutomationCheckpoint, StepStatus};

use super::WalkResult;
use super::checkpoint::WalkFrame;
use super::markers::{BRANCH_OUTCOME_KIND, branch_marker, mark_outcome};
use super::walk::{StepsResult, WalkCtx, walk_frame};

/// One concurrently-run branch: its own walk frame (so a `#<index>`-suffixed
/// step ref never collides across branches) and the body it walks.
pub(crate) struct Branch<'a> {
    pub frame: WalkFrame,
    pub steps: &'a [Step],
}

/// One branch's contribution to a `run_branches` pass. Carries no error —
/// once settled, whichever markers are `Failed` is read straight off the
/// checkpoint after the pass, in branch (index) order, so the earliest
/// failing item always wins regardless of settle timing.
enum BranchOutcome {
    Settled,
    Parked,
    /// Validation rejects a break inside a concurrent branch, so reaching
    /// this means a definition slipped past it.
    Broke,
}

/// Advances one branch: if it already has a marker, that IS its outcome for
/// this pass (no re-walk — the replay-safety `run_branches` depends on).
/// Otherwise walks it fresh and, if it just settled, writes the marker.
async fn advance_branch(
    ctx: &WalkCtx<'_>,
    block_id: &str,
    marker: &str,
    branch: &Branch<'_>,
    checkpoint: AutomationCheckpoint,
) -> Result<(AutomationCheckpoint, BranchOutcome), StoreError> {
    if checkpoint.steps.contains_key(marker) {
        return Ok((checkpoint, BranchOutcome::Settled));
    }

    let StepsResult { result, checkpoint } =
        walk_frame(branch.steps, checkpoint, ctx, branch.frame.clone()).await?;
    match result {
        WalkResult::Done => {
            let checkpoint = mark_outcome(
                ctx,
                marker,
                block_id,
                BRANCH_OUTCOME_KIND,
                StepStatus::Succeeded,
                None,
            )
            .await?;
            Ok((checkpoint, BranchOutcome::Settled))
        }
        WalkResult::Failed { error } => {
            let checkpoint = mark_outcome(
                ctx,
                marker,
                block_id,
                BRANCH_OUTCOME_KIND,
                StepStatus::Failed,
                Some(error),
            )
            .await?;
            Ok((checkpoint, BranchOutcome::Settled))
        }
        WalkResult::Parked => Ok((checkpoint, BranchOutcome::Parked)),
        WalkResult::Broke => Ok((checkpoint, BranchOutcome::Broke)),
    }
}

/// Runs every branch within ONE checkpoint, wait-for-all: a branch that
/// parks does not stop the others from starting, and a branch that fails
/// does not stop its siblings from finishing. `finalize_and_emit` has no way
/// to cancel a sibling's in-flight agent chat, so fail-fast would finalize
/// the run while other chats keep spending tokens with nowhere for their
/// settle to land (it bounces off `TerminalRun`).
///
/// Each branch's terminal outcome is recorded in a marker entry the same way
/// `run_retry`'s attempts are: `walk_frame` treats an already-`failed` step
/// as settled and skips past it, so without a marker a replayed failed
/// branch would read as done.
///
/// Returns the FIRST (by branch/index order) failure once nothing is
/// parked — the caller passes `branches` in ascending item-index order, so
/// this is index order, matching sequential `run_repeat`'s "earliest item
/// wins" report regardless of which branch's settle actually lands last.
pub(crate) async fn run_branches(
    block_id: &str,
    branches: &[Branch<'_>],
    checkpoint: AutomationCheckpoint,
    ctx: &WalkCtx<'_>,
) -> Result<StepsResult, StoreError> {
    let mut current = checkpoint;
    let mut parked = false;

    for branch in branches {
        let marker = branch_marker(block_id, &branch.frame.ref_suffix);
        let (next, outcome) = advance_branch(ctx, block_id, &marker, branch, current).await?;
        current = next;
        match outcome {
            BranchOutcome::Settled => {}
            BranchOutcome::Parked => parked = true,
            BranchOutcome::Broke => {
                return Ok(StepsResult {
                    result: WalkResult::Failed {
                        error: format!(
                            "internal: break escaped a concurrent branch of '{block_id}'"
                        ),
                    },
                    checkpoint: current,
                });
            }
        }
    }

    if parked {
        return Ok(StepsResult {
            result: WalkResult::Parked,
            checkpoint: current,
        });
    }
    let result = branches
        .iter()
        .find_map(|branch| {
            let marker = branch_marker(block_id, &branch.frame.ref_suffix);
            current
                .steps
                .get(&marker)
                .filter(|entry| entry.status == StepStatus::Failed)
                .map(|entry| entry.error.clone().unwrap_or_default())
        })
        .map(|error| WalkResult::Failed { error })
        .unwrap_or(WalkResult::Done);
    Ok(StepsResult {
        result,
        checkpoint: current,
    })
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md Phase 4a), not a TS port
// confidence: high
// todos: 0
// notes: run_branches is the general driver, agnostic to WHICH branches it's
//        given each pass; blocks_concurrent_repeat.rs is its scheduler for
//        `repeat`'s `concurrency` field.
