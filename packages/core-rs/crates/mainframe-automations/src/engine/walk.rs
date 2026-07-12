//! Linear step walker (Node walk.ts): skip committed steps, park on
//! `waiting`, execute the first live leaf, commit, continue. If/Repeat never
//! write an entry under their own id — only leaf verbs do — so re-entering a
//! block on resume is always safe.

use std::sync::Arc;

use serde_json::{Map, Value};

use crate::domain::Step;
use crate::error::StoreError;
use crate::ports::{AutomationEvent, Clock, EventSink, to_run_summary};
use crate::store::{AutomationCheckpoint, RunRecord, RunStore, StepStatus};

use super::checkpoint::{WalkFrame, build_scope, set_step};
use super::{BoxFuture, StepOutcome, VerbContext, VerbPorts, WalkResult, blocks};

pub(crate) struct WalkCtx<'a> {
    pub run_id: &'a str,
    pub store: &'a RunStore,
    pub ports: &'a dyn VerbPorts,
    pub clock: Arc<dyn Clock>,
    pub events: &'a dyn EventSink,
}

pub(crate) struct StepsResult {
    pub result: WalkResult,
    pub checkpoint: AutomationCheckpoint,
}

pub(crate) async fn walk_steps(
    steps: &[Step],
    checkpoint: AutomationCheckpoint,
    ctx: &WalkCtx<'_>,
) -> Result<WalkResult, StoreError> {
    let outcome = walk_frame(steps, checkpoint, ctx, WalkFrame::default()).await?;
    Ok(outcome.result)
}

/// Boxed for async recursion (blocks re-enter `walk_frame` for their bodies).
pub(crate) fn walk_frame<'a>(
    steps: &'a [Step],
    checkpoint: AutomationCheckpoint,
    ctx: &'a WalkCtx<'a>,
    frame: WalkFrame,
) -> BoxFuture<'a, Result<StepsResult, StoreError>> {
    Box::pin(async move {
        let mut current = checkpoint;
        for step in steps {
            let step_ref = format!("{}{}", step.id(), frame.ref_suffix);
            match current.steps.get(&step_ref).map(|e| e.status) {
                Some(StepStatus::Succeeded | StepStatus::Skipped | StepStatus::Failed) => continue,
                Some(StepStatus::Waiting) => {
                    return Ok(StepsResult {
                        result: WalkResult::Parked,
                        checkpoint: current,
                    });
                }
                Some(StepStatus::Running) | None => {}
            }
            let StepsResult { result, checkpoint } =
                run_step(step, &step_ref, current, ctx, &frame).await?;
            current = checkpoint;
            let fatal = matches!(result, WalkResult::Failed { .. }) && !step.keep_going();
            if matches!(result, WalkResult::Parked) || fatal {
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
    })
}

async fn run_step(
    step: &Step,
    step_ref: &str,
    checkpoint: AutomationCheckpoint,
    ctx: &WalkCtx<'_>,
    frame: &WalkFrame,
) -> Result<StepsResult, StoreError> {
    match step {
        Step::If(block) => blocks::run_if(block, checkpoint, ctx, frame).await,
        Step::Repeat(block) => blocks::run_repeat(block, checkpoint, ctx, frame).await,
        _ => run_leaf(step, step_ref, checkpoint, ctx, frame).await,
    }
}

async fn run_leaf(
    step: &Step,
    step_ref: &str,
    checkpoint: AutomationCheckpoint,
    ctx: &WalkCtx<'_>,
    frame: &WalkFrame,
) -> Result<StepsResult, StoreError> {
    // Decision 12: commit a pre-effect `running` marker for verbs whose side
    // effects cannot be blindly re-run after a crash.
    let non_idempotent = matches!(step, Step::RunAction(_) | Step::AskAgent(_));
    let current = if non_idempotent {
        commit(ctx, step, step_ref, StepStatus::Running, None, None)
            .await?
            .checkpoint
    } else {
        checkpoint
    };

    let scope = build_scope(&current, frame, ctx.clock.clone());
    let verb_ctx = VerbContext {
        run_id: ctx.run_id,
        step_ref,
        scope: &scope,
    };
    let outcome = dispatch(step, ctx.ports, verb_ctx).await;

    match outcome {
        StepOutcome::Completed { outputs } => {
            let record = commit(
                ctx,
                step,
                step_ref,
                StepStatus::Succeeded,
                Some(outputs),
                None,
            )
            .await?;
            emit_settled(ctx, &record);
            Ok(StepsResult {
                result: WalkResult::Done,
                checkpoint: record.checkpoint,
            })
        }
        StepOutcome::Wait { wake_at } => {
            let (step_ref_owned, step_id, kind) = commit_keys(step, step_ref);
            let record = ctx
                .store
                .patch_checkpoint(ctx.run_id, move |cp| {
                    set_step(
                        cp,
                        &step_ref_owned,
                        &step_id,
                        &kind,
                        StepStatus::Waiting,
                        None,
                        None,
                    );
                    cp.wake_at = wake_at;
                })
                .await?;
            Ok(StepsResult {
                result: WalkResult::Parked,
                checkpoint: record.checkpoint,
            })
        }
        StepOutcome::Failed { error } => {
            let record = commit(
                ctx,
                step,
                step_ref,
                StepStatus::Failed,
                None,
                Some(error.clone()),
            )
            .await?;
            emit_settled(ctx, &record);
            Ok(StepsResult {
                result: WalkResult::Failed { error },
                checkpoint: record.checkpoint,
            })
        }
    }
}

/// A6 — every leaf-step terminal transition streams to the run view.
fn emit_settled(ctx: &WalkCtx<'_>, record: &RunRecord) {
    ctx.events.emit(AutomationEvent::RunUpdated {
        run: to_run_summary(record),
    });
}

fn commit_keys(step: &Step, step_ref: &str) -> (String, String, String) {
    (
        step_ref.to_string(),
        step.id().to_string(),
        step.kind_name().to_string(),
    )
}

async fn commit(
    ctx: &WalkCtx<'_>,
    step: &Step,
    step_ref: &str,
    status: StepStatus,
    outputs: Option<Map<String, Value>>,
    error: Option<String>,
) -> Result<RunRecord, StoreError> {
    let (step_ref, step_id, kind) = commit_keys(step, step_ref);
    ctx.store
        .patch_checkpoint(ctx.run_id, move |cp| {
            set_step(cp, &step_ref, &step_id, &kind, status, outputs, error);
        })
        .await
}

async fn dispatch(step: &Step, ports: &dyn VerbPorts, ctx: VerbContext<'_>) -> StepOutcome {
    match step {
        Step::AskAgent(s) => ports.ask_agent(s, ctx).await,
        Step::AskMe(s) => ports.ask_me(s, ctx).await,
        Step::RunAction(s) => ports.run_action(s, ctx).await,
        Step::Notify(s) => ports.notify(s, ctx).await,
        // Unreachable by construction (run_step routes blocks first); a
        // graceful error beats a forbidden panic in library code.
        Step::If(_) | Step::Repeat(_) => StepOutcome::Failed {
            error: "internal: block dispatched as a leaf verb".to_string(),
        },
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T4.1), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node engine/walk.ts (walkFrame/runLeaf); commits funnel
//        through RunStore::patch_checkpoint (one-tx read-modify-write).
