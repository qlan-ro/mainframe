//! Engine-internal checkpoint markers. Node has no equivalent: Rust's
//! attempt/branch bookkeeping needs its own entries because `walk_frame`
//! treats an already-settled step as done and skips past it, so a replayed
//! failed attempt/branch would otherwise read as a success. A marker is
//! never a user step — `project_timeline` filters every kind here before it
//! reaches the editor, which has no verb entry for one.

use crate::error::StoreError;
use crate::store::{AutomationCheckpoint, StepStatus};

use super::checkpoint::set_step;
use super::walk::WalkCtx;

pub const RETRY_ATTEMPT_KIND: &str = "retry_attempt";
pub const BRANCH_OUTCOME_KIND: &str = "branch_outcome";
pub const REPEAT_WATERMARK_KIND: &str = "repeat_watermark";

/// True for a checkpoint entry kind the engine wrote about itself rather
/// than a step the automation author placed.
pub fn is_engine_marker(kind: &str) -> bool {
    matches!(
        kind,
        RETRY_ATTEMPT_KIND | BRANCH_OUTCOME_KIND | REPEAT_WATERMARK_KIND
    )
}

/// Namespaces one concurrent-repeat branch's terminal marker. `@c` sits
/// outside the step-id charset (`^[a-zA-Z0-9_-]+$`), so it can never collide
/// with a user-authored step ref — including one an out-of-band failure
/// (agent settle, deadline) writes directly, bypassing `blocks_concurrent`.
pub(crate) fn branch_marker(block_id: &str, ref_suffix: &str) -> String {
    format!("{block_id}@c{ref_suffix}")
}

/// Writes the enclosing branch's own marker `Failed`, synchronously and in
/// place — called from `out_of_band::fail_step_out_of_band`, the write
/// shared by the two failure paths (agent settle, deadline) that bypass
/// `blocks_concurrent`'s driver entirely. Without this, the driver's next
/// replay would skip the failed leaf (already terminal) and launder the
/// branch into `Succeeded`. A no-op outside a concurrent branch.
pub(crate) fn fail_enclosing_branch(
    checkpoint: &mut AutomationCheckpoint,
    enclosing_branch: &Option<(String, String)>,
    error: &str,
) {
    let Some((block_id, ref_suffix)) = enclosing_branch else {
        return;
    };
    let marker = branch_marker(block_id, ref_suffix);
    set_step(
        checkpoint,
        &marker,
        block_id,
        BRANCH_OUTCOME_KIND,
        StepStatus::Failed,
        None,
        Some(error.to_string()),
        None,
    );
}

/// Records one marker's terminal outcome — the shared write retry's attempts
/// and concurrent branches both use to survive a replay.
pub(crate) async fn mark_outcome(
    ctx: &WalkCtx<'_>,
    marker: &str,
    step_id: &str,
    kind: &str,
    status: StepStatus,
    error: Option<String>,
) -> Result<AutomationCheckpoint, StoreError> {
    let (marker, step_id, kind) = (marker.to_string(), step_id.to_string(), kind.to_string());
    let record = ctx
        .store
        .patch_checkpoint(ctx.run_id, move |cp| {
            set_step(
                cp,
                &marker,
                &step_id,
                &kind,
                status,
                None,
                error.clone(),
                None,
            );
        })
        .await?;
    Ok(record.checkpoint)
}
