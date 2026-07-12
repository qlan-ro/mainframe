//! If/Repeat block execution (T4.2 lands the real semantics; these arms fail
//! the step gracefully until then).

use crate::domain::{IfBlock, RepeatBlock};
use crate::error::StoreError;
use crate::store::AutomationCheckpoint;

use super::WalkResult;
use super::checkpoint::WalkFrame;
use super::walk::{StepsResult, WalkCtx};

pub(crate) async fn run_if(
    block: &IfBlock,
    checkpoint: AutomationCheckpoint,
    _ctx: &WalkCtx<'_>,
    _frame: &WalkFrame,
) -> Result<StepsResult, StoreError> {
    Ok(StepsResult {
        result: WalkResult::Failed {
            error: format!("if block '{}' lands in T4.2", block.id),
        },
        checkpoint,
    })
}

pub(crate) async fn run_repeat(
    block: &RepeatBlock,
    checkpoint: AutomationCheckpoint,
    _ctx: &WalkCtx<'_>,
    _frame: &WalkFrame,
) -> Result<StepsResult, StoreError> {
    Ok(StepsResult {
        result: WalkResult::Failed {
            error: format!("repeat block '{}' lands in T4.2", block.id),
        },
        checkpoint,
    })
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T4.2), not a TS port
// confidence: high
// todos: 0
// notes: T4.1 placeholder — replaced by the T4.2 commit in this same series.
