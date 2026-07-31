//! `apply_record`'s merge of a retained run with an incoming record. Split out
//! of `store.rs` to keep that file under the size limit — this is pure data
//! resolution, no store state.

use mainframe_types::claude_workflow::{ClaudeWorkflowRun, ClaudeWorkflowRunStatus};

/// Per D7/D8: a record is final by definition, so it supersedes the retained
/// run's `phases`, `agents`, `status`, `terminal_at` and `structure_revision`
/// regardless of `structure_revision`. Cumulative totals stay at
/// `max(retained, incoming)` so observed numbers never regress, and a learned
/// `run_id`/`workflow_name` is copied from whichever side already has one.
///
/// Two carve-outs: a record whose `phases` and `agents` are both empty does not
/// clobber a populated retained run's structure (the same inversion as *Merge
/// precedence* rule 2), and an `Unavailable` status does not overwrite a known
/// one.
pub(crate) fn resolve_record(
    retained: &ClaudeWorkflowRun,
    incoming: &ClaudeWorkflowRun,
) -> ClaudeWorkflowRun {
    let incoming_empty = incoming.phases.is_empty() && incoming.agents.is_empty();
    let retained_empty = retained.phases.is_empty() && retained.agents.is_empty();
    let keep_retained_structure = incoming_empty && !retained_empty;

    let mut resolved = retained.clone();
    // `Unavailable` is the record path's stand-in for a status `run_status`
    // could not classify (status.rs: "the run is left untouched"), so it must
    // not overwrite one we already know.
    resolved.status = if incoming.status == ClaudeWorkflowRunStatus::Unavailable {
        retained.status
    } else {
        incoming.status
    };
    resolved.terminal_at = incoming.terminal_at.or(retained.terminal_at);
    resolved.total_tokens = retained.total_tokens.max(incoming.total_tokens);
    resolved.duration_ms = retained.duration_ms.max(incoming.duration_ms);
    resolved.run_id = retained.run_id.clone().or_else(|| incoming.run_id.clone());
    resolved.workflow_name = retained
        .workflow_name
        .clone()
        .or_else(|| incoming.workflow_name.clone());

    if !keep_retained_structure {
        resolved.source = incoming.source;
        resolved.structure_revision = incoming.structure_revision;
        resolved.phases = incoming.phases.clone();
        resolved.agents = incoming.agents.clone();
    }

    resolved
}
