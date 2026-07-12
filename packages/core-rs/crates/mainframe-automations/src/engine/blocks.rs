//! If/Repeat block execution (Node walk.ts `runIf`/`runRepeat`, contract
//! Decisions 3/8). Blocks never write a checkpoint entry under their own id
//! — only leaf verbs do — so re-entering one on resume is always safe: the
//! nested walk short-circuits on already-terminal steps.

use crate::domain::{IfBlock, RepeatBlock};
use crate::error::StoreError;
use crate::store::AutomationCheckpoint;
use crate::tokens::{TokenValue, evaluate};

use super::WalkResult;
use super::checkpoint::{WalkFrame, build_scope};
use super::walk::{StepsResult, WalkCtx, walk_frame};

/// Contract §2: an unbounded Repeat rewrites the whole checkpoint JSON per
/// advance() (O(N²)); cap fan-out instead of discovering it in production.
pub(crate) const MAX_REPEAT_ITEMS: usize = 500;

pub(crate) async fn run_if(
    block: &IfBlock,
    checkpoint: AutomationCheckpoint,
    ctx: &WalkCtx<'_>,
    frame: &WalkFrame,
) -> Result<StepsResult, StoreError> {
    let matched = {
        let scope = build_scope(&checkpoint, frame, ctx.clock.clone());
        evaluate(&block.conditions, block.match_mode, &scope)
    };
    let branch = if matched {
        &block.then
    } else {
        &block.otherwise
    };
    walk_frame(branch, checkpoint, ctx, frame.clone()).await
}

pub(crate) async fn run_repeat(
    block: &RepeatBlock,
    checkpoint: AutomationCheckpoint,
    ctx: &WalkCtx<'_>,
    frame: &WalkFrame,
) -> Result<StepsResult, StoreError> {
    let resolved = {
        let scope = build_scope(&checkpoint, frame, ctx.clock.clone());
        scope.resolve(&block.items)
    };
    let Some(TokenValue::List(items)) = resolved else {
        return Ok(StepsResult {
            result: WalkResult::Failed {
                error: format!(
                    "repeat '{}' items token did not resolve to a list",
                    block.id
                ),
            },
            checkpoint,
        });
    };
    if items.len() > MAX_REPEAT_ITEMS {
        return Ok(StepsResult {
            result: WalkResult::Failed {
                error: format!(
                    "list has {} items, exceeds the {MAX_REPEAT_ITEMS}-item limit",
                    items.len()
                ),
            },
            checkpoint,
        });
    }

    let mut current = checkpoint;
    for (index, item) in items.into_iter().enumerate() {
        let iter_frame = frame.iteration(index, item);
        let StepsResult { result, checkpoint } =
            walk_frame(&block.steps, current, ctx, iter_frame).await?;
        current = checkpoint;
        if !matches!(result, WalkResult::Done) {
            return Ok(StepsResult {
                result,
                checkpoint: current,
            });
        }
    }
    Ok(StepsResult {
        result: WalkResult::Done,
        checkpoint: current,
    })
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T4.2), not a TS port
// confidence: high
// todos: 0
// notes: error strings mirror Node walk.ts verbatim (they cross the wire in
//        run.error); a body failure bubbles as the BLOCK's result, so the
//        outer walk consults the block's own keepGoing (Node parity).
