//! If/Repeat block execution. Blocks never write a checkpoint entry under their
//! own id — only leaf verbs do — so re-entering one on resume is always safe:
//! the nested walk short-circuits on already-terminal steps.

use crate::domain::{IfBlock, LoopBlock, LoopMode, MAX_REPEAT_ITEMS, RepeatBlock, RetryBlock};
use crate::error::StoreError;
use crate::store::{AutomationCheckpoint, StepKind, StepStatus};
use crate::tokens::{TokenValue, evaluate};

use super::WalkResult;
use super::blocks_concurrent_repeat;
use super::checkpoint::{WalkFrame, build_scope};
use super::markers::mark_outcome;
use super::walk::{StepsResult, WalkCtx, walk_frame};

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

    // Absent or 1 keeps this exact sequential loop; concurrency > 1 hands
    // scheduling to the branch driver instead.
    if let Some(concurrency) = block.concurrency.filter(|&n| n > 1) {
        return blocks_concurrent_repeat::run_repeat_concurrent(
            block,
            &items,
            concurrency,
            checkpoint,
            ctx,
            frame,
        )
        .await;
    }

    repeat_sequential(block, items, checkpoint, ctx, frame).await
}

/// Retry: re-walk the body from the top until it succeeds or the attempts run
/// out.
///
/// Attempts cannot be inferred by replaying the walk: `walk_frame` treats an
/// already-`failed` entry as settled and continues past it, so a replayed
/// failed attempt would report `Done`. Each attempt therefore gets its own
/// frame AND a marker entry recording its outcome, which is also what lets a
/// restart mid-retry resume on the right attempt instead of starting over.
pub(crate) async fn run_retry(
    block: &RetryBlock,
    checkpoint: AutomationCheckpoint,
    ctx: &WalkCtx<'_>,
    frame: &WalkFrame,
) -> Result<StepsResult, StoreError> {
    let mut current = checkpoint;
    let mut last_error: Option<String> = None;

    for attempt in 0..block.max_attempts {
        let marker = format!("{}@a{}{}", block.id, attempt, frame.ref_suffix);
        match current.steps.get(&marker) {
            Some(entry) if entry.status == StepStatus::Succeeded => {
                return Ok(StepsResult {
                    result: WalkResult::Done,
                    checkpoint: current,
                });
            }
            Some(entry) if entry.status == StepStatus::Failed => {
                last_error = entry.error.clone();
                continue;
            }
            _ => {}
        }

        let StepsResult { result, checkpoint } =
            walk_frame(&block.steps, current, ctx, frame.pass(attempt as usize)).await?;
        current = checkpoint;

        match result {
            WalkResult::Done => {
                current = mark_attempt(ctx, &marker, block, StepStatus::Succeeded, None).await?;
                return Ok(StepsResult {
                    result: WalkResult::Done,
                    checkpoint: current,
                });
            }
            WalkResult::Failed { error } => {
                current =
                    mark_attempt(ctx, &marker, block, StepStatus::Failed, Some(error.clone()))
                        .await?;
                last_error = Some(error);
            }
            // Parked mid-attempt, or a break unwinding to an outer loop: the
            // attempt is unfinished, so it gets no marker and the resume
            // re-enters the same frame.
            other => {
                return Ok(StepsResult {
                    result: other,
                    checkpoint: current,
                });
            }
        }
    }

    retry_exhausted(block, current, last_error)
}

async fn mark_attempt(
    ctx: &WalkCtx<'_>,
    marker: &str,
    block: &RetryBlock,
    status: StepStatus,
    error: Option<String>,
) -> Result<AutomationCheckpoint, StoreError> {
    mark_outcome(
        ctx,
        marker,
        &block.id,
        StepKind::RetryAttempt,
        status,
        error,
    )
    .await
}

/// Condition loop. Unlike `run_repeat`, the continue test is re-evaluated
/// against a freshly built scope every pass, so the body's own outputs decide
/// whether there is another one.
pub(crate) async fn run_loop(
    block: &LoopBlock,
    checkpoint: AutomationCheckpoint,
    ctx: &WalkCtx<'_>,
    frame: &WalkFrame,
) -> Result<StepsResult, StoreError> {
    let mut current = checkpoint;
    for index in 0..block.max_iterations {
        let keep_going = loop_continues(block, &current, ctx, frame, index);
        if !keep_going {
            return Ok(StepsResult {
                result: WalkResult::Done,
                checkpoint: current,
            });
        }

        let pass_frame = frame.pass(index as usize);
        let StepsResult { result, checkpoint } =
            walk_frame(&block.steps, current, ctx, pass_frame).await?;
        current = checkpoint;
        if matches!(result, WalkResult::Broke) {
            return Ok(StepsResult {
                result: WalkResult::Done,
                checkpoint: current,
            });
        }
        if !matches!(result, WalkResult::Done) {
            return Ok(StepsResult {
                result,
                checkpoint: current,
            });
        }
    }

    // Bound exhausted with the condition still unmet. Failing is the honest
    // report — a poll that never went green must not read as one that did.
    Ok(StepsResult {
        result: WalkResult::Failed {
            error: format!(
                "loop '{}' stopped after {} passes without its condition being met",
                block.id, block.max_iterations
            ),
        },
        checkpoint: current,
    })
}

async fn repeat_sequential(
    block: &RepeatBlock,
    items: Vec<TokenValue>,
    checkpoint: AutomationCheckpoint,
    ctx: &WalkCtx<'_>,
    frame: &WalkFrame,
) -> Result<StepsResult, StoreError> {
    let mut current = checkpoint;
    for (index, item) in items.into_iter().enumerate() {
        let iter_frame = frame.iteration(index, item);
        let StepsResult { result, checkpoint } =
            walk_frame(&block.steps, current, ctx, iter_frame).await?;
        current = checkpoint;
        // A break leaves the loop, and the loop itself completes normally.
        if matches!(result, WalkResult::Broke) {
            break;
        }
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

fn retry_exhausted(
    block: &RetryBlock,
    current: AutomationCheckpoint,
    last_error: Option<String>,
) -> Result<StepsResult, StoreError> {
    Ok(StepsResult {
        result: WalkResult::Failed {
            error: last_error.unwrap_or_else(|| {
                format!("retry '{}' ran no attempts — maxAttempts is 0", block.id)
            }),
        },
        checkpoint: current,
    })
}

mod loop_condition;
use loop_condition::loop_continues;
