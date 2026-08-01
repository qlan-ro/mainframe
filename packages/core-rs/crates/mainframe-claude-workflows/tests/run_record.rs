//! Red-phase (Task 8): `record::parse_run_record` / `record::read_run_records`
//! over the on-disk `wf_<runId>.json` shape (verified fact 5). Turned green by
//! Task 14.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use mainframe_claude_workflows::record::{parse_run_record, read_run_records};
use mainframe_types::claude_workflow::ClaudeWorkflowRunSource;
use mainframe_types::claude_workflow::ClaudeWorkflowRunStatus;
use serde_json::Value;

fn fixture() -> Value {
    let raw = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/wf_run_record.json"
    ))
    .unwrap();
    serde_json::from_str(&raw).unwrap()
}

#[test]
fn parse_run_record_maps_the_full_key_set() {
    let run = parse_run_record(&fixture()).unwrap();
    assert_eq!(run.run_id, Some("run-42".to_string()));
    assert_eq!(run.task_id, "task-9");
    assert_eq!(run.workflow_name, Some("todo-lane".to_string()));
    assert_eq!(run.status, ClaudeWorkflowRunStatus::Completed);
    assert_eq!(run.total_tokens, 5500);
    assert_eq!(run.duration_ms, 45000);
    assert_eq!(run.structure_revision, Some(45000));
    assert_eq!(run.source, ClaudeWorkflowRunSource::Record);
    assert_eq!(run.phases.len(), 2);
    assert_eq!(run.agents.len(), 2);
    assert_eq!(run.agents[0].agent_id, "agent-alpha");
}

#[test]
fn parse_run_record_maps_a_killed_status_to_stopped() {
    let mut value = fixture();
    value["status"] = Value::String("killed".to_string());
    let run = parse_run_record(&value).unwrap();
    assert_eq!(run.status, ClaudeWorkflowRunStatus::Stopped);
}

#[test]
fn parse_run_record_keeps_a_parsed_structure_when_the_status_is_unrecognized() {
    let mut value = fixture();
    value["status"] = Value::String("cancelling".to_string());
    let run = parse_run_record(&value).unwrap();
    assert_ne!(run.status, ClaudeWorkflowRunStatus::Unavailable);
    assert_eq!(run.phases.len(), 2);
    assert_eq!(run.agents.len(), 2);
}

#[test]
fn parse_run_record_keeps_a_parsed_structure_when_the_status_is_absent() {
    let mut value = fixture();
    value.as_object_mut().unwrap().remove("status");
    let run = parse_run_record(&value).unwrap();
    assert_ne!(run.status, ClaudeWorkflowRunStatus::Unavailable);
    assert_eq!(run.agents.len(), 2);
}

#[test]
fn parse_run_record_is_unavailable_only_when_it_also_recovered_no_structure() {
    let mut value = fixture();
    value["status"] = Value::String("cancelling".to_string());
    value["workflowProgress"] = Value::Array(Vec::new());
    let run = parse_run_record(&value).unwrap();
    assert_eq!(run.status, ClaudeWorkflowRunStatus::Unavailable);
}

#[test]
fn parse_run_record_returns_none_for_a_malformed_record() {
    assert!(parse_run_record(&Value::String("not an object".to_string())).is_none());
    assert!(parse_run_record(&Value::Null).is_none());
}

#[tokio::test]
async fn read_run_records_returns_exactly_the_wf_prefixed_json_files() {
    let dir = tempfile::tempdir().unwrap();
    let project_dir = dir.path();
    let workflows_dir = project_dir.join("sess-1").join("workflows");
    std::fs::create_dir_all(&workflows_dir).unwrap();

    let mut first = fixture();
    first["runId"] = Value::String("run-1".to_string());
    first["taskId"] = Value::String("task-1".to_string());
    let mut second = fixture();
    second["runId"] = Value::String("run-2".to_string());
    second["taskId"] = Value::String("task-2".to_string());

    std::fs::write(
        workflows_dir.join("wf_run-1.json"),
        serde_json::to_string(&first).unwrap(),
    )
    .unwrap();
    std::fs::write(
        workflows_dir.join("wf_run-2.json"),
        serde_json::to_string(&second).unwrap(),
    )
    .unwrap();
    std::fs::write(workflows_dir.join("journal.jsonl"), "{}").unwrap();

    let runs = read_run_records(project_dir, "sess-1").await;
    assert_eq!(runs.len(), 2);
}

#[tokio::test]
async fn read_run_records_returns_empty_when_the_directory_does_not_exist() {
    let dir = tempfile::tempdir().unwrap();
    let runs = read_run_records(dir.path(), "sess-missing").await;
    assert!(runs.is_empty());
}
