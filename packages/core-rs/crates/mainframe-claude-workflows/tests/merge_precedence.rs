//! Red-phase (Task 8): `merge::merge_runs` precedence rules, one test per
//! numbered rule in the plan's *Merge precedence*. Turned green by Task 15.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use mainframe_claude_workflows::merge::merge_runs;
use mainframe_types::claude_workflow::{
    ClaudeWorkflowPhase, ClaudeWorkflowRun, ClaudeWorkflowRunSource, ClaudeWorkflowRunStatus,
};

fn phase(index: i64, title: &str) -> ClaudeWorkflowPhase {
    ClaudeWorkflowPhase {
        index,
        title: title.to_string(),
        kind: None,
    }
}

fn snapshot_run(task_id: &str, run_id: Option<&str>, structure_revision: i64) -> ClaudeWorkflowRun {
    let mut run = ClaudeWorkflowRun::new_seed(task_id, None);
    run.run_id = run_id.map(str::to_string);
    run.source = ClaudeWorkflowRunSource::Snapshot;
    run.status = ClaudeWorkflowRunStatus::Running;
    run.structure_revision = Some(structure_revision);
    run.phases = vec![phase(0, "In-memory phase")];
    run
}

fn record_run(task_id: &str, run_id: Option<&str>) -> ClaudeWorkflowRun {
    let mut run = ClaudeWorkflowRun::new_seed(task_id, None);
    run.run_id = run_id.map(str::to_string);
    run.source = ClaudeWorkflowRunSource::Record;
    run.status = ClaudeWorkflowRunStatus::Completed;
    run.terminal_at = Some(1_700_000_000_000);
    run.phases = vec![phase(0, "Record phase")];
    run
}

#[test]
fn rule_1_record_supersedes_snapshot_for_the_same_run() {
    let memory = vec![snapshot_run("t1", Some("r1"), 100)];
    let records = vec![record_run("t1", Some("r1"))];
    let merged = merge_runs(memory, records);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].source, ClaudeWorkflowRunSource::Record);
    assert_eq!(merged[0].phases[0].title, "Record phase");
}

#[test]
fn rule_2_empty_record_does_not_clobber_a_populated_snapshot() {
    let memory = vec![snapshot_run("t2", None, 50)];
    let mut empty_record = record_run("t2", Some("r2"));
    empty_record.phases.clear();
    let records = vec![empty_record];

    let merged = merge_runs(memory, records);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].source, ClaudeWorkflowRunSource::Snapshot);
    assert_eq!(merged[0].phases[0].title, "In-memory phase");
    assert_eq!(merged[0].run_id, Some("r2".to_string()));
}

#[test]
fn rule_3_between_two_snapshots_the_larger_structure_revision_wins() {
    let older = snapshot_run("t3", Some("r3"), 100);
    let newer = snapshot_run("t3", Some("r3"), 200);
    let merged = merge_runs(vec![older, newer], vec![]);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].structure_revision, Some(200));
}

#[test]
fn rule_3_same_revision_snapshots_use_the_later_fold_candidate() {
    let mut first = snapshot_run("t4", Some("r4"), 100);
    first.total_tokens = 10;
    let mut second = snapshot_run("t4", Some("r4"), 100);
    second.total_tokens = 20;
    let merged = merge_runs(vec![first, second], vec![]);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].total_tokens, 20);
}

#[test]
fn rule_4_a_run_present_on_only_one_side_passes_through_unchanged() {
    let memory = vec![snapshot_run("t5", Some("r5"), 10)];
    let merged = merge_runs(memory, vec![]);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].task_id, "t5");

    let records = vec![record_run("t6", Some("r6"))];
    let merged = merge_runs(vec![], records);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].task_id, "t6");
}

#[test]
fn rule_5_output_is_ordered_by_revision_then_terminal_at_then_task_id() {
    let low = snapshot_run("t-low", Some("r-low"), 10);
    let high = snapshot_run("t-high", Some("r-high"), 90);
    let terminal = record_run("t-mid", Some("r-mid"));
    let merged = merge_runs(vec![low, high], vec![terminal]);
    let ids: Vec<&str> = merged.iter().map(|r| r.task_id.as_str()).collect();
    assert_eq!(ids, vec!["t-low", "t-high", "t-mid"]);
}

#[test]
fn asymmetric_identity_learns_the_run_id_from_the_terminal_record() {
    let memory = vec![snapshot_run("t7", None, 10)];
    let records = vec![record_run("t7", Some("r7-learned"))];
    let merged = merge_runs(memory, records);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].source, ClaudeWorkflowRunSource::Record);
    assert_eq!(merged[0].run_id, Some("r7-learned".to_string()));
}
