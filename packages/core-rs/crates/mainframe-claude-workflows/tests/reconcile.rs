//! Red-phase (Task 9): `reconcile::spawn_terminal_reconcile` — the terminal
//! record backfill (D7). Turned green by Task 16.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::Arc;
use std::time::Duration;

use mainframe_claude_workflows::reconcile::{RecordLocation, spawn_terminal_reconcile};
use mainframe_claude_workflows::store::{ClaudeWorkflowStore, ProgressUsage};
use mainframe_types::claude_workflow::ClaudeWorkflowRunSource;
use serde_json::Value;

const CHAT: &str = "chat-reconcile";
const TASK: &str = "task-9";

fn fixture() -> Value {
    let raw = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/wf_run_record.json"
    ))
    .unwrap();
    serde_json::from_str(&raw).unwrap()
}

#[tokio::test]
async fn a_found_record_supersedes_the_retained_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let workflows_dir = dir.path().join("sess-1").join("workflows");
    std::fs::create_dir_all(&workflows_dir).unwrap();
    std::fs::write(
        workflows_dir.join("wf_run-42.json"),
        serde_json::to_string(&fixture()).unwrap(),
    )
    .unwrap();

    let store = Arc::new(ClaudeWorkflowStore::new());
    store.seed(CHAT, TASK, None);
    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 10,
            duration_ms: 1_000,
        },
        None,
    );

    let mut rx = store.subscribe();
    spawn_terminal_reconcile(
        Arc::clone(&store),
        CHAT.to_string(),
        TASK.to_string(),
        RecordLocation {
            project_dir: dir.path().to_path_buf(),
            session_id: "sess-1".to_string(),
        },
    );

    let event = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(event.run.source, ClaudeWorkflowRunSource::Record);
    assert_eq!(event.run.agents.len(), 2);

    let run = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(run.source, ClaudeWorkflowRunSource::Record);
}

#[tokio::test]
async fn a_missing_record_leaves_the_stamped_status_and_snapshot_alone() {
    let dir = tempfile::tempdir().unwrap();

    let store = Arc::new(ClaudeWorkflowStore::new());
    store.seed(CHAT, TASK, None);
    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 10,
            duration_ms: 1_000,
        },
        None,
    );
    let before = store.runs_for_chat(CHAT).into_iter().next().unwrap();

    let mut rx = store.subscribe();
    spawn_terminal_reconcile(
        Arc::clone(&store),
        CHAT.to_string(),
        TASK.to_string(),
        RecordLocation {
            project_dir: dir.path().to_path_buf(),
            session_id: "sess-missing".to_string(),
        },
    );

    assert!(
        tokio::time::timeout(Duration::from_millis(300), rx.recv())
            .await
            .is_err()
    );
    let after = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(before.source, after.source);
    assert_eq!(before.total_tokens, after.total_tokens);
}
