use super::*;
use mainframe_background_tasks::tracker::TaskSeed;
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
    ctx.core.background_tasks.adopt(chat_id, task);
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

async fn tail_of(content: &[u8], max_bytes: u64) -> (Option<String>, String, String) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("task1.output");
    std::fs::write(&path, content).unwrap();
    let tail = read_tail(path.to_str().unwrap(), max_bytes).await.unwrap();
    let response = tail_response(tail);
    let header = |name: &str| {
        response
            .headers()
            .get(name)
            .map(|value| value.to_str().unwrap().to_owned())
    };
    let (truncated, exposed) = (
        header("x-output-truncated"),
        header("access-control-expose-headers").unwrap(),
    );
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (
        truncated,
        exposed,
        String::from_utf8(body.to_vec()).unwrap(),
    )
}

#[tokio::test]
async fn output_says_when_it_leaves_out_the_start() {
    let (truncated, exposed, text) = tail_of(b"abcdef", 4).await;
    assert_eq!(truncated.as_deref(), Some("true"));
    assert_eq!(text, "cdef");
    // The app's origin is not the daemon's; a header it can't read marks nothing.
    assert_eq!(exposed, "x-output-truncated");
}

#[tokio::test]
async fn output_at_the_limit_is_whole() {
    let (truncated, _, text) = tail_of(b"abcd", 4).await;
    assert_eq!(truncated, None);
    assert_eq!(text, "abcd");
}
