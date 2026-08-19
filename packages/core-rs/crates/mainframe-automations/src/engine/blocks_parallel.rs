//! `parallel` block execution (Phase 4b). Unlike `blocks_concurrent_repeat`,
//! whose branches are the SAME body run once per item, a `parallel` block's
//! branches are authored directly — so this is a thin caller of
//! `blocks_concurrent::run_branches`, not a scheduler: every branch is ready
//! from the start, with no window/watermark to compute.

use crate::domain::ParallelBlock;
use crate::error::StoreError;
use crate::store::AutomationCheckpoint;

use super::blocks_concurrent::{Branch, run_branches};
use super::checkpoint::WalkFrame;
use super::walk::{StepsResult, WalkCtx};

/// Each branch gets `frame.pass(index)` — the same `#<i>`-suffix scheme a
/// condition loop's pass uses, not `frame.iteration`: a `parallel` branch has
/// no per-branch item, so nothing should push onto `current_items`. Reusing
/// the same suffix shape is what lets `domain::concurrent_branch`'s
/// ancestor-preserving lookup treat a `parallel` boundary exactly like a
/// concurrent Repeat's.
pub(crate) async fn run_parallel(
    block: &ParallelBlock,
    checkpoint: AutomationCheckpoint,
    ctx: &WalkCtx<'_>,
    frame: &WalkFrame,
) -> Result<StepsResult, StoreError> {
    let branches: Vec<Branch> = block
        .branches
        .iter()
        .enumerate()
        .map(|(index, steps)| Branch {
            frame: frame.pass(index),
            steps,
        })
        .collect();
    run_branches(&block.id, &branches, checkpoint, ctx).await
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md Phase 4b), not a TS port
// confidence: high
// todos: 0
// notes: validation (min 2 / max 32 branches, nested-product cap, break
//        rejection) lives in domain/validate.rs + domain/validate_breaks.rs;
//        this module only ever sees an already-valid ParallelBlock.
