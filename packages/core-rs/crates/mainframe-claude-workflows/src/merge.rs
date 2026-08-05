//! Merges the store's in-memory runs with disk-backfilled records for the
//! REST history path (D9). See the plan's *Merge precedence* rules — a
//! pairwise identity predicate, not a per-run fallback key.

use mainframe_types::claude_workflow::{ClaudeWorkflowRun, ClaudeWorkflowRunSource};

/// Folds `memory` and `records` into one vector, ordered by
/// `structure_revision.or(terminal_at).unwrap_or(0)` ascending then `task_id`.
pub fn merge_runs(
    memory: Vec<ClaudeWorkflowRun>,
    records: Vec<ClaudeWorkflowRun>,
) -> Vec<ClaudeWorkflowRun> {
    let mut merged: Vec<ClaudeWorkflowRun> = Vec::new();

    for candidate in memory.into_iter().chain(records) {
        match merged
            .iter()
            .position(|incumbent| same_run(&candidate, incumbent))
        {
            Some(index) => {
                let incumbent = merged.remove(index);
                let resolved = if wins(&candidate, &incumbent) {
                    carry_missing_identity(candidate, &incumbent)
                } else {
                    carry_missing_identity(incumbent, &candidate)
                };
                merged.insert(index, resolved);
            }
            None => merged.push(candidate),
        }
    }

    merged.sort_by_key(sort_key);
    merged
}

/// Compares `run_id` when both sides have one; otherwise falls back to
/// `task_id`. This is the *only* identity predicate — no per-run fallback key.
fn same_run(a: &ClaudeWorkflowRun, b: &ClaudeWorkflowRun) -> bool {
    match (&a.run_id, &b.run_id) {
        (Some(a_id), Some(b_id)) => a_id == b_id,
        _ => a.task_id == b.task_id,
    }
}

fn is_empty(run: &ClaudeWorkflowRun) -> bool {
    run.phases.is_empty() && run.agents.is_empty()
}

fn source_rank(source: ClaudeWorkflowRunSource) -> u8 {
    match source {
        ClaudeWorkflowRunSource::Launch => 0,
        ClaudeWorkflowRunSource::Snapshot => 1,
        ClaudeWorkflowRunSource::Record => 2,
    }
}

/// Rule 1/2/3: does `candidate` supersede `incumbent`? Record beats
/// Snapshot/Launch unless the record-side carve-out (rule 2) applies; between
/// two snapshots the larger `structure_revision` wins, with ties (including
/// two absent revisions) going to the later fold candidate.
fn wins(candidate: &ClaudeWorkflowRun, incumbent: &ClaudeWorkflowRun) -> bool {
    let candidate_rank = source_rank(candidate.source);
    let incumbent_rank = source_rank(incumbent.source);

    if candidate_rank != incumbent_rank {
        let candidate_is_higher = candidate_rank > incumbent_rank;
        let (higher, lower) = if candidate_is_higher {
            (candidate, incumbent)
        } else {
            (incumbent, candidate)
        };
        if higher.source == ClaudeWorkflowRunSource::Record && is_empty(higher) && !is_empty(lower)
        {
            return !candidate_is_higher;
        }
        return candidate_is_higher;
    }

    match candidate.source {
        ClaudeWorkflowRunSource::Snapshot => {
            match (candidate.structure_revision, incumbent.structure_revision) {
                (Some(c), Some(i)) => c >= i,
                _ => true,
            }
        }
        _ => true,
    }
}

/// Copies a learned `run_id`/`workflow_name` from `loser` onto `winner` when
/// `winner` lacks it — the asymmetric-identity case (A1).
fn carry_missing_identity(
    mut winner: ClaudeWorkflowRun,
    loser: &ClaudeWorkflowRun,
) -> ClaudeWorkflowRun {
    if winner.run_id.is_none() {
        winner.run_id = loser.run_id.clone();
    }
    if winner.workflow_name.is_none() {
        winner.workflow_name = loser.workflow_name.clone();
    }
    winner
}

pub(crate) fn sort_key(run: &ClaudeWorkflowRun) -> (i64, String) {
    (
        run.structure_revision.or(run.terminal_at).unwrap_or(0),
        run.task_id.clone(),
    )
}
