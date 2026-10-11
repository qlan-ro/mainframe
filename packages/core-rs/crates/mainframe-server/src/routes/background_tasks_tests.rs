use super::*;
use mainframe_background_tasks::tracker::{AdoptOptions, TaskSeed};
use mainframe_types::background_task::{
    BackgroundTask, BackgroundTaskStatus, BackgroundTaskToolName, BackgroundWorkKind,
};

use crate::test_support::read_json as read;

fn seed_task(ctx: &Arc<AppCtx>, chat_id: &str) -> String {
    let task = ctx.core.background_tasks.start(
        chat_id,
        TaskSeed {
            id: "task1".into(),
            kind: BackgroundWorkKind::Bash,
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: "tu1".into(),
            command: "sleep 1".into(),
            description: "d".into(),
            workflow_name: None,
        },
        "/tmp/mf-out".into(),
    );
    task.id
}

/// A tracked task with `output_path: None` (only reachable via adopt/recovery).
fn seed_task_no_output(ctx: &Arc<AppCtx>, chat_id: &str) -> String {
    let task = BackgroundTask {
        id: "task-no-out".into(),
        kind: BackgroundWorkKind::Bash,
        tool_name: BackgroundTaskToolName::Bash,
        tool_use_id: "tu2".into(),
        command: "sleep 1".into(),
        description: "d".into(),
        output_path: None,
        started_at: 0,
        ended_at: None,
        status: BackgroundTaskStatus::Running,
        last_output_line: None,
        summary: None,
        usage: None,
        recovered: Some(true),
        workflow_name: None,
        run_id: None,
    };
    let id = task.id.clone();
    ctx.core
        .background_tasks
        .adopt(chat_id, task, AdoptOptions::default());
    id
}

#[tokio::test]
async fn list_returns_tracker_tasks() {
    let ctx = AppCtx::test_ctx();
    let id = seed_task(&ctx, "c1");
    let (status, body) = read(list(State(ctx.clone()), Path("c1".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["tasks"][0]["id"], serde_json::json!(id));
}

#[tokio::test]
async fn list_unknown_chat_is_empty() {
    let ctx = AppCtx::test_ctx();
    let (status, body) = read(list(State(ctx.clone()), Path("nope".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["tasks"], serde_json::json!([]));
}

#[tokio::test]
async fn output_task_not_found_404() {
    let ctx = AppCtx::test_ctx();
    let resp = output(
        State(ctx.clone()),
        Path(("c1".into(), "missing".into())),
        Query(OutputQuery { bytes: None }),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "task not found");
}

#[tokio::test]
async fn output_no_output_path_409() {
    let ctx = AppCtx::test_ctx();
    let id = seed_task_no_output(&ctx, "c1");
    let resp = output(
        State(ctx.clone()),
        Path(("c1".into(), id)),
        Query(OutputQuery { bytes: None }),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "no_output");
}

#[tokio::test]
async fn output_rejects_zero_bytes_400() {
    let ctx = AppCtx::test_ctx();
    let resp = output(
        State(ctx.clone()),
        Path(("c1".into(), "t".into())),
        Query(OutputQuery { bytes: Some(0) }),
    )
    .await;
    assert_eq!(read(resp).await.unwrap().0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn kill_task_not_found_404() {
    let ctx = AppCtx::test_ctx();
    let resp = kill(State(ctx.clone()), Path(("c1".into(), "missing".into()))).await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "task not found");
}
