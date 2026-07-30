//! Merges the store's in-memory runs with disk-backfilled records for the
//! REST history path (D9). See the plan's *Merge precedence* rules — a
//! pairwise identity predicate, not a per-run fallback key.

use mainframe_types::claude_workflow::ClaudeWorkflowRun;

/// Folds `memory` and `records` into one vector, ordered by
/// `structure_revision.or(terminal_at).unwrap_or(0)` ascending then `task_id`.
pub fn merge_runs(
    _memory: Vec<ClaudeWorkflowRun>,
    _records: Vec<ClaudeWorkflowRun>,
) -> Vec<ClaudeWorkflowRun> {
    unimplemented!("wf-core")
}
