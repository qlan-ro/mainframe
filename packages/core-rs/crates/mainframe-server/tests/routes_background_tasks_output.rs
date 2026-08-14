//! Red-phase (todo #338, Task 3): the background-task output-tail route must
//! succeed for a spool file the daemon actually resolves to (the daemon's real
//! uid), and must keep rejecting a path outside the spool root.
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::fs::DirBuilderExt;
use std::process::Command;

use mainframe_background_tasks::tracker::{BackgroundTaskTracker, TaskSeed};
use mainframe_types::background_task::{BackgroundTaskToolName, BackgroundWorkKind};
use reqwest::StatusCode;
use support::spawn_test_server;
use tempfile::TempDir;

fn oracle_uid() -> u32 {
    let output = Command::new("id").arg("-u").output().unwrap();
    String::from_utf8(output.stdout)
        .unwrap()
        .trim()
        .parse()
        .unwrap()
}

fn base_tmp_dir() -> String {
    std::env::var("CLAUDE_CODE_TMPDIR").unwrap_or_else(|_| "/tmp".into())
}

fn seed(tracker: &BackgroundTaskTracker, chat_id: &str, task_id: &str, output_path: String) {
    tracker.start(
        chat_id,
        TaskSeed {
            id: task_id.to_string(),
            kind: BackgroundWorkKind::Bash,
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: "tu-1".to_string(),
            command: "sleep 100".to_string(),
            description: String::new(),
            workflow_name: None,
        },
        output_path,
    );
}

#[tokio::test]
async fn returns_the_tail_of_a_spool_file_under_the_real_spool_root() {
    let uid = oracle_uid();
    if uid == 0 {
        // Running as root: `claude-0` is the correct root and this test is meaningless.
        return;
    }

    let base = base_tmp_dir();
    let root = format!("{base}/claude-{uid}");
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&root)
        .unwrap();
    let scratch = TempDir::new_in(&root).unwrap();
    let tasks_dir = scratch.path().join("sess-tail").join("tasks");
    std::fs::create_dir_all(&tasks_dir).unwrap();
    let output_path = tasks_dir.join("task-tail.output");
    std::fs::write(&output_path, b"real spool tail bytes").unwrap();

    let server = spawn_test_server(None).await;
    seed(
        &server.ctx.background_tasks,
        "chat-tail",
        "task-tail",
        output_path.to_string_lossy().into_owned(),
    );

    let resp =
        reqwest::get(server.http_url("/api/chats/chat-tail/background-tasks/task-tail/output"))
            .await
            .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.text().await.unwrap();
    assert!(body.ends_with("real spool tail bytes"));
}

#[tokio::test]
async fn rejects_a_path_outside_the_spool_root() {
    let outside = TempDir::new().unwrap();
    let output_path = outside.path().join("task-outside.output");
    std::fs::write(&output_path, b"not in the spool root").unwrap();

    let server = spawn_test_server(None).await;
    seed(
        &server.ctx.background_tasks,
        "chat-outside",
        "task-outside",
        output_path.to_string_lossy().into_owned(),
    );

    let resp = reqwest::get(
        server.http_url("/api/chats/chat-outside/background-tasks/task-outside/output"),
    )
    .await
    .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["error"], "invalid_path");
}
