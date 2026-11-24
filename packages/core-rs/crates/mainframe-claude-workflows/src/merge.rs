//! Precedence between two views of the same workflow run.
//!
//! [`merge_runs`] folds the store's in-memory runs with disk records for the
//! REST history path; [`resolve_record`] applies one record to a retained run
//! during terminal reconciliation. Two runs are the same run when their
//! `run_id`s match, or, when either side lacks one, their `task_id`s match.
//!
//! Merge precedence (`tests/merge_precedence.rs` has one test per rule):
//!
//! 1. A record beats a snapshot, which beats a launch seed.
//! 2. A record with no phases or agents never displaces a run that has them.
//! 3. Between two snapshots the larger `structure_revision` wins; a tie, or a
//!    missing revision on either side, goes to the later candidate.
//! 4. A run present on one side only passes through unchanged.
//! 5. Output is ordered by `structure_revision`, else `terminal_at`, else 0,
//!    then by `task_id`.
//!
//! Whichever side wins inherits a `run_id` or `workflow_name` only the other
//! side learned.

use mainframe_types::claude_workflow::{
    ClaudeWorkflowRun, ClaudeWorkflowRunSource, ClaudeWorkflowRunStatus,
};

/// Folds `memory` and `records` into one vector under the rules above.
pub fn merge_runs(
    memory: Vec<ClaudeWorkflowRun>,
    records: Vec<ClaudeWorkflowRun>,
) -> Vec<ClaudeWorkflowRun> {
    let mut merged: Vec<ClaudeWorkflowRun> = Vec::new();

    for candidate in memory.into_iter().chain(records) {
        match merged
            .iter_mut()
            .find(|incumbent| same_run(&candidate, incumbent))
        {
            Some(incumbent) if wins(&candidate, incumbent) => {
                let loser = std::mem::replace(incumbent, candidate);
                fill_missing_identity(incumbent, &loser);
            }
            Some(incumbent) => fill_missing_identity(incumbent, &candidate),
            None => merged.push(candidate),
        }
    }

    sort_runs(&mut merged);
    merged
}

/// Applies a record to the run the store retained for the same task. A record
/// is final, so it replaces `status`, `structure_revision`, `phases` and
/// `agents` whatever the revisions say. Cumulative totals keep the larger
/// value so observed numbers never regress.
///
/// Two carve-outs: an empty record keeps the retained structure (rule 2), and
/// an `Unavailable` status, the record path's stand-in for a status it could
/// not classify, does not overwrite a known one.
pub(crate) fn resolve_record(
    retained: &ClaudeWorkflowRun,
    incoming: &ClaudeWorkflowRun,
) -> ClaudeWorkflowRun {
    let mut resolved = retained.clone();
    fill_missing_identity(&mut resolved, incoming);
    if incoming.status != ClaudeWorkflowRunStatus::Unavailable {
        resolved.status = incoming.status;
    }
    resolved.terminal_at = incoming.terminal_at.or(retained.terminal_at);
    resolved.total_tokens = retained.total_tokens.max(incoming.total_tokens);
    resolved.duration_ms = retained.duration_ms.max(incoming.duration_ms);

    if has_structure(incoming) || !has_structure(retained) {
        resolved.source = incoming.source;
        resolved.structure_revision = incoming.structure_revision;
        resolved.phases.clone_from(&incoming.phases);
        resolved.agents.clone_from(&incoming.agents);
    }

    resolved
}

/// Rule 5's order, shared with `ClaudeWorkflowStore::runs_for_chat`.
pub(crate) fn sort_runs(runs: &mut [ClaudeWorkflowRun]) {
    runs.sort_by(|a, b| sort_key(a).cmp(&sort_key(b)));
}

fn sort_key(run: &ClaudeWorkflowRun) -> (i64, &str) {
    (
        run.structure_revision.or(run.terminal_at).unwrap_or(0),
        &run.task_id,
    )
}

fn same_run(a: &ClaudeWorkflowRun, b: &ClaudeWorkflowRun) -> bool {
    match (&a.run_id, &b.run_id) {
        (Some(a_id), Some(b_id)) => a_id == b_id,
        _ => a.task_id == b.task_id,
    }
}

fn has_structure(run: &ClaudeWorkflowRun) -> bool {
    !run.phases.is_empty() || !run.agents.is_empty()
}

fn source_rank(source: ClaudeWorkflowRunSource) -> u8 {
    match source {
        ClaudeWorkflowRunSource::Launch => 0,
        ClaudeWorkflowRunSource::Snapshot => 1,
        ClaudeWorkflowRunSource::Record => 2,
    }
}

fn is_empty_record(run: &ClaudeWorkflowRun) -> bool {
    run.source == ClaudeWorkflowRunSource::Record && !has_structure(run)
}

/// Whether `candidate` supersedes `incumbent` (rules 1 to 3).
fn wins(candidate: &ClaudeWorkflowRun, incumbent: &ClaudeWorkflowRun) -> bool {
    if candidate.source != incumbent.source {
        if is_empty_record(candidate) && has_structure(incumbent) {
            return false;
        }
        if is_empty_record(incumbent) && has_structure(candidate) {
            return true;
        }
        return source_rank(candidate.source) > source_rank(incumbent.source);
    }

    match (
        candidate.source,
        candidate.structure_revision,
        incumbent.structure_revision,
    ) {
        (ClaudeWorkflowRunSource::Snapshot, Some(c), Some(i)) => c >= i,
        _ => true,
    }
}

fn fill_missing_identity(winner: &mut ClaudeWorkflowRun, loser: &ClaudeWorkflowRun) {
    if winner.run_id.is_none() {
        winner.run_id.clone_from(&loser.run_id);
    }
    if winner.workflow_name.is_none() {
        winner.workflow_name.clone_from(&loser.workflow_name);
    }
}
