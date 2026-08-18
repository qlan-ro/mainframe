//! Scheduler for `repeat`'s `concurrency` field: decides, each pass, which
//! iterations `blocks_concurrent::run_branches` should run, then hands them
//! over. Iterations start in ascending order, so the ever-admitted set is
//! always a prefix of the item list — a durable watermark (highest admitted
//! index + 1) is therefore enough to know what's been admitted across a
//! restart, with no need to scan the checkpoint for it.
//!
//! The watermark replaces an earlier `branch_started` that string-matched a
//! ref's `#`-suffix chain against every OTHER checkpoint entry: any
//! unrelated step elsewhere in the automation whose suffix happened to
//! match (e.g. a plain sequential repeat's `ping#0`) read as this block's
//! branch 0 already starting, and a falsely-`started` branch skips the
//! concurrency budget check entirely.

use serde_json::{Map, Value};

use crate::domain::RepeatBlock;
use crate::error::StoreError;
use crate::store::{AutomationCheckpoint, StepStatus};
use crate::tokens::TokenValue;

use super::WalkResult;
use super::blocks_concurrent::{Branch, run_branches};
use super::checkpoint::{WalkFrame, set_step};
use super::markers::{REPEAT_WATERMARK_KIND, branch_marker};
use super::walk::{StepsResult, WalkCtx};

/// Concurrency-driven Repeat: iterations still use `frame.iteration(index,
/// item)` so `⟨current⟩` resolves per item exactly as the sequential path
/// does — only the scheduling differs.
pub(crate) async fn run_repeat_concurrent(
    block: &RepeatBlock,
    items: &[TokenValue],
    concurrency: u32,
    checkpoint: AutomationCheckpoint,
    ctx: &WalkCtx<'_>,
    frame: &WalkFrame,
) -> Result<StepsResult, StoreError> {
    let marker = watermark_marker(&block.id, &frame.ref_suffix);
    let mut current = checkpoint;
    loop {
        let window = concurrent_window(block, items, concurrency, &current, frame, &marker);
        if window.frames.is_empty() {
            break;
        }
        if window.watermark > read_watermark(&current, &marker) {
            current = mark_watermark(ctx, &marker, &block.id, window.watermark).await?;
        }
        let branches: Vec<Branch> = window
            .frames
            .into_iter()
            .map(|iter_frame| Branch {
                frame: iter_frame,
                steps: &block.steps,
            })
            .collect();
        let StepsResult {
            result,
            checkpoint: next,
        } = run_branches(&block.id, &branches, current, ctx).await?;
        current = next;
        match result {
            // This window fully succeeded — loop again for the next one.
            // Wait-for-all applies to the WHOLE item list, so items that
            // have not started yet still get their turn.
            WalkResult::Done => {}
            WalkResult::Parked | WalkResult::Failed { .. } => {
                return Ok(StepsResult {
                    result,
                    checkpoint: current,
                });
            }
            WalkResult::Broke => unreachable!("run_branches converts Broke into Failed itself"),
        }
    }
    Ok(StepsResult {
        result: WalkResult::Done,
        checkpoint: current,
    })
}

struct ConcurrentWindow {
    frames: Vec<WalkFrame>,
    watermark: usize,
}

/// Builds this pass's branch list: every already-admitted iteration whose
/// marker isn't `Succeeded` yet (still outstanding, or `Failed` and awaiting
/// `run_branches`' scan), plus newly-admitted iterations up to `concurrency`
/// outstanding — but ONLY while nothing admitted so far has failed. Without
/// that gate, a failure discovered between passes (e.g. an agent settling
/// out-of-band) would free up budget and let the window keep growing instead
/// of stopping, burning far more chats than the concurrency cap intends.
fn concurrent_window(
    block: &RepeatBlock,
    items: &[TokenValue],
    concurrency: u32,
    checkpoint: &AutomationCheckpoint,
    frame: &WalkFrame,
    marker: &str,
) -> ConcurrentWindow {
    let watermark = read_watermark(checkpoint, marker).min(items.len());
    let mut frames = Vec::new();
    let mut outstanding = 0u32;
    let mut has_failure = false;
    for (index, item) in items.iter().enumerate().take(watermark) {
        let suffix = frame.iteration_suffix(index);
        match checkpoint
            .steps
            .get(&branch_marker(&block.id, &suffix))
            .map(|entry| entry.status)
        {
            Some(StepStatus::Succeeded) => continue,
            Some(StepStatus::Failed) => {
                has_failure = true;
                frames.push(frame.iteration(index, item.clone()));
            }
            _ => {
                outstanding += 1;
                frames.push(frame.iteration(index, item.clone()));
            }
        }
    }

    let mut admitted = watermark;
    if !has_failure {
        for (index, item) in items.iter().enumerate().skip(watermark) {
            if outstanding >= concurrency {
                break;
            }
            outstanding += 1;
            admitted = index + 1;
            frames.push(frame.iteration(index, item.clone()));
        }
    }
    ConcurrentWindow {
        frames,
        watermark: admitted,
    }
}

fn watermark_marker(block_id: &str, ref_suffix: &str) -> String {
    format!("{block_id}@w{ref_suffix}")
}

fn read_watermark(checkpoint: &AutomationCheckpoint, marker: &str) -> usize {
    checkpoint
        .steps
        .get(marker)
        .and_then(|entry| entry.outputs.as_ref())
        .and_then(|outputs| outputs.get("admitted"))
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize
}

/// Persists the watermark the same way every other engine marker survives a
/// restart: as an ordinary (filtered-from-the-timeline) checkpoint entry.
async fn mark_watermark(
    ctx: &WalkCtx<'_>,
    marker: &str,
    block_id: &str,
    admitted: usize,
) -> Result<AutomationCheckpoint, StoreError> {
    let mut outputs = Map::new();
    outputs.insert("admitted".to_string(), Value::from(admitted as u64));
    let (marker, block_id) = (marker.to_string(), block_id.to_string());
    let record = ctx
        .store
        .patch_checkpoint(ctx.run_id, move |cp| {
            set_step(
                cp,
                &marker,
                &block_id,
                REPEAT_WATERMARK_KIND,
                StepStatus::Succeeded,
                Some(outputs),
                None,
                None,
            );
        })
        .await?;
    Ok(record.checkpoint)
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md Phase 4a), not a TS port
// confidence: high
// todos: 0
// notes: split out of blocks_concurrent.rs (300-line cap) — this file owns
//        "which iterations run this pass", blocks_concurrent.rs owns
//        "running a given list of branches to a verdict".
