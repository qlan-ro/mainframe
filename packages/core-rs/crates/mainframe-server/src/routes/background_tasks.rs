//! Ported from `src/server/routes/background-tasks.ts` — list / output / kill for
//! a chat's background tasks.
//!
//! The TS route takes injectable deps (tracker, sessionForChat, validator,
//! killImpl); the Rust port reads them off `AppCtx`: the tracker is
//! `ctx.background_tasks`, `sessionForChat` bridges `ChatManager::get_session_for_chat`
//! (an `Arc<dyn AdapterSession>`) into the `SessionLike` the kill helper expects,
//! and the validator is the default platform spool-root validator. This file ports
//! fully — no Phase-4 seams.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::Deserialize;

use mainframe_adapter_api::AdapterSession;
use mainframe_background_tasks::kill::{
    KillArgs, KillResult, SessionLike, StopResult, kill_background_task,
};
use mainframe_background_tasks::spool_validator::{
    Platform, SpoolValidator, SpoolValidatorDeps, make_spool_validator,
};

use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};

const MAX_READ_BYTES: u64 = 1024 * 1024;
const DEFAULT_READ_BYTES: u64 = 8 * 1024;

/// Bridges a live `Arc<dyn AdapterSession>` into the `SessionLike` the kill helper
/// needs (the TS route's `sessionForChat` returned exactly this capability).
struct AdapterSessionLike(Arc<dyn AdapterSession>);

impl SessionLike for AdapterSessionLike {
    fn stop_background_task<'a>(
        &'a self,
        task_id: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = StopResult> + Send + 'a>> {
        let session = self.0.clone();
        let task_id = task_id.to_string();
        Box::pin(async move {
            match session.stop_background_task(task_id).await {
                Ok(r) => StopResult {
                    ok: r.ok,
                    error: r.error,
                },
                Err(err) => StopResult {
                    ok: false,
                    error: Some(err.to_string()),
                },
            }
        })
    }
}

fn default_validator() -> impl SpoolValidator {
    make_spool_validator(SpoolValidatorDeps {
        platform: Platform::current(),
        getuid: None,
        env: std::env::vars().collect(),
        realpath: None,
        tmpdir: None,
    })
}

async fn list(State(ctx): State<Arc<AppCtx>>, Path(chat_id): Path<String>) -> Response {
    if chat_id.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "bad request");
    }
    ok(serde_json::json!({ "tasks": ctx.background_tasks.list(&chat_id) }))
}

#[derive(Deserialize)]
struct OutputQuery {
    bytes: Option<u64>,
}

async fn read_tail(output_path: &str, max_bytes: u64) -> std::io::Result<String> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    let mut file = tokio::fs::File::open(output_path).await?;
    let size = file.metadata().await?.len();
    let start = size.saturating_sub(max_bytes);
    file.seek(std::io::SeekFrom::Start(start)).await?;
    let mut buf = Vec::with_capacity((size - start) as usize);
    file.take(size - start).read_to_end(&mut buf).await?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

async fn output(
    State(ctx): State<Arc<AppCtx>>,
    Path((chat_id, task_id)): Path<(String, String)>,
    Query(q): Query<OutputQuery>,
) -> Response {
    if chat_id.is_empty() || task_id.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "bad request");
    }
    if let Some(bytes) = q.bytes
        && (bytes == 0 || bytes > MAX_READ_BYTES)
    {
        return fail(StatusCode::BAD_REQUEST, "bad request");
    }
    let Some(task) = ctx.background_tasks.get(&chat_id, &task_id) else {
        return fail(StatusCode::NOT_FOUND, "task not found");
    };
    let Some(output_path) = task.output_path.clone() else {
        return fail(StatusCode::CONFLICT, "no_output");
    };
    let valid = default_validator().validate(&output_path, &task.id).await;
    if !valid {
        tracing::warn!(%chat_id, %task_id, %output_path, "spool-root validation failed");
        return fail(StatusCode::CONFLICT, "invalid_path");
    }
    let max_bytes = q.bytes.unwrap_or(DEFAULT_READ_BYTES).min(MAX_READ_BYTES);
    match read_tail(&output_path, max_bytes).await {
        Ok(text) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            text,
        )
            .into_response(),
        Err(err) => {
            tracing::warn!(%output_path, %err, "failed to read spool file");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "read failed")
        }
    }
}

async fn kill(
    State(ctx): State<Arc<AppCtx>>,
    Path((chat_id, task_id)): Path<(String, String)>,
) -> Response {
    if chat_id.is_empty() || task_id.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "bad request");
    }
    if ctx.background_tasks.get(&chat_id, &task_id).is_none() {
        return fail(StatusCode::NOT_FOUND, "task not found");
    }
    // sessionForChat: null for recovered orphans (no live CLI).
    let session_like = ctx
        .chat_manager
        .as_ref()
        .and_then(|cm| cm.get_session_for_chat(&chat_id))
        .map(AdapterSessionLike);
    let result = kill_background_task(KillArgs {
        chat_id: &chat_id,
        task_id: &task_id,
        session: session_like.as_ref().map(|s| s as &dyn SessionLike),
        tracker: &ctx.background_tasks,
    })
    .await;
    match result {
        KillResult::Ok { .. } => ok_empty(),
        KillResult::Err { error, .. } => fail(StatusCode::BAD_GATEWAY, error),
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/chats/{chatId}/background-tasks", get(list))
        .route(
            "/api/chats/{chatId}/background-tasks/{taskId}/output",
            get(output),
        )
        .route(
            "/api/chats/{chatId}/background-tasks/{taskId}/kill",
            post(kill),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use mainframe_background_tasks::tracker::{AdoptOptions, TaskSeed};
    use mainframe_types::background_task::{
        BackgroundTask, BackgroundTaskStatus, BackgroundTaskToolName, BackgroundWorkKind,
    };

    async fn read(resp: Response) -> (StatusCode, serde_json::Value) {
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    fn seed_task(ctx: &Arc<AppCtx>, chat_id: &str) -> String {
        let task = ctx.background_tasks.start(
            chat_id,
            TaskSeed {
                id: "task1".into(),
                kind: BackgroundWorkKind::Bash,
                tool_name: BackgroundTaskToolName::Bash,
                tool_use_id: "tu1".into(),
                command: "sleep 1".into(),
                description: "d".into(),
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
        };
        let id = task.id.clone();
        ctx.background_tasks
            .adopt(chat_id, task, AdoptOptions::default());
        id
    }

    #[tokio::test]
    async fn list_returns_tracker_tasks() {
        let ctx = AppCtx::test_ctx();
        let id = seed_task(&ctx, "c1");
        let (status, body) = read(list(State(ctx.clone()), Path("c1".into())).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["data"]["tasks"][0]["id"], serde_json::json!(id));
    }

    #[tokio::test]
    async fn list_unknown_chat_is_empty() {
        let ctx = AppCtx::test_ctx();
        let (status, body) = read(list(State(ctx.clone()), Path("nope".into())).await).await;
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
        let (status, body) = read(resp).await;
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
        let (status, body) = read(resp).await;
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
        assert_eq!(read(resp).await.0, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn kill_task_not_found_404() {
        let ctx = AppCtx::test_ctx();
        let resp = kill(State(ctx.clone()), Path(("c1".into(), "missing".into()))).await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "task not found");
    }
}

// PORT STATUS: src/server/routes/background-tasks.ts (3 endpoints, 143 lines)
// confidence: high
// todos: 0
// notes: Full port — no seam. tracker = ctx.background_tasks; sessionForChat bridges
// ChatManager::get_session_for_chat (Arc<dyn AdapterSession>) into SessionLike via
// AdapterSessionLike; validator = default platform spool-root validator (getuid
// None). readTail mirrors the TS stat+seek tail read; text/plain output. kill maps
// KillResult::Ok→okEmpty, Err→502 with the error string (TS `502 result.error`).
