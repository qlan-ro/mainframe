//! List / output / kill for a chat's background tasks.
//!
//! The tracker is `ctx.core.background_tasks`, and
//! `ChatManager::get_session_for_chat` (an `Arc<dyn AdapterSession>`) is
//! bridged into the `SessionLike` the kill helper expects. Output is read only
//! from paths inside the CLI spool root.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::Deserialize;

use mainframe_background_tasks::kill::{KillArgs, KillError, SessionLike, kill_background_task};
use mainframe_background_tasks::spool_root::is_spool_task_output;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};

const MAX_READ_BYTES: u64 = 1024 * 1024;
const DEFAULT_READ_BYTES: u64 = 8 * 1024;
/// Present on an output response that leaves out the start of the file.
const OUTPUT_TRUNCATED: &str = "x-output-truncated";

async fn list(State(ctx): State<Arc<AppCtx>>, Path(chat_id): Path<String>) -> Response {
    if chat_id.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "bad request");
    }
    ok(serde_json::json!({ "tasks": ctx.core.background_tasks.list(&chat_id) }))
}

#[derive(Deserialize)]
struct OutputQuery {
    bytes: Option<u64>,
}

struct OutputTail {
    text: String,
    truncated: bool,
}

async fn read_tail(output_path: &str, max_bytes: u64) -> std::io::Result<OutputTail> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    let mut file = tokio::fs::File::open(output_path).await?;
    let size = file.metadata().await?.len();
    let start = size.saturating_sub(max_bytes);
    file.seek(std::io::SeekFrom::Start(start)).await?;
    let mut buf = Vec::with_capacity((size - start) as usize);
    file.take(size - start).read_to_end(&mut buf).await?;
    Ok(OutputTail {
        text: String::from_utf8_lossy(&buf).into_owned(),
        truncated: start > 0,
    })
}

fn tail_response(OutputTail { text, truncated }: OutputTail) -> Response {
    let mut response = (
        [
            (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
            (header::ACCESS_CONTROL_EXPOSE_HEADERS, OUTPUT_TRUNCATED),
        ],
        text,
    )
        .into_response();
    if truncated {
        response
            .headers_mut()
            .insert(OUTPUT_TRUNCATED, HeaderValue::from_static("true"));
    }
    response
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
    let Some(task) = ctx.core.background_tasks.get(&chat_id, &task_id) else {
        return fail(StatusCode::NOT_FOUND, "task not found");
    };
    let Some(output_path) = task.output_path.clone() else {
        return fail(StatusCode::CONFLICT, "no_output");
    };
    if !is_spool_task_output(std::path::Path::new(&output_path), &task.id).await {
        tracing::warn!(%chat_id, %task_id, %output_path, "spool-root validation failed");
        return fail(StatusCode::CONFLICT, "invalid_path");
    }
    let max_bytes = q.bytes.unwrap_or(DEFAULT_READ_BYTES).min(MAX_READ_BYTES);
    match read_tail(&output_path, max_bytes).await {
        Ok(tail) => tail_response(tail),
        Err(err) => crate::respond::fail_internal(
            format!("failed to read spool file output_path={}", output_path),
            &err,
            "read failed",
        ),
    }
}

async fn kill(
    State(ctx): State<Arc<AppCtx>>,
    Path((chat_id, task_id)): Path<(String, String)>,
) -> Response {
    if chat_id.is_empty() || task_id.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "bad request");
    }
    if ctx.core.background_tasks.get(&chat_id, &task_id).is_none() {
        return fail(StatusCode::NOT_FOUND, "task not found");
    }
    // sessionForChat: null for recovered orphans (no live CLI).
    let session_like = ctx
        .chat
        .chat_manager
        .get_session_for_chat(&chat_id)
        .map(crate::session_kill_bridge::SessionKillBridge);
    let result = kill_background_task(KillArgs {
        chat_id: &chat_id,
        task_id: &task_id,
        session: session_like.as_ref().map(|s| s as &dyn SessionLike),
        tracker: &ctx.core.background_tasks,
    })
    .await;
    match result {
        Ok(_) => ok_empty(),
        Err(KillError::NotFound) => fail(StatusCode::NOT_FOUND, "task not found"),
        Err(error) => fail(StatusCode::BAD_GATEWAY, error.to_string()),
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
#[path = "background_tasks_tests.rs"]
mod tests;
