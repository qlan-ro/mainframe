//! Chat configuration, interrupt/resume/trust commands, and queue edits through ChatManager.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{patch, post};
use serde::Deserialize;

use mainframe_types::settings::ExecutionMode;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};
use crate::routes::body::parse_body;

/// serde only invokes this when the key is present, so a plain `Option<T>`
/// would collapse an explicit JSON `null` into the same `None` as an absent
/// key. Wrapping in `Some` here keeps absent → outer `None` and present
/// (including `null`) → outer `Some`, which is what the `projectId` presence
/// check needs.
async fn chat_exists(ctx: &Arc<AppCtx>, id: &str) -> Result<bool, crate::respond::ApiError> {
    let lookup = id.to_string();
    match ctx.core.db.call(move |db| db.chats.get(&lookup)).await {
        Ok(chat) => Ok(chat.is_some()),
        Err(err) => Err(crate::respond::ApiError::internal("get chat", &err)),
    }
}

/// Config PATCH body: every field optional; `permissionMode` takes one of
/// `EXECUTION_MODES` from `packages/types/src/settings.ts` (no `plan`), so it
/// maps to `ExecutionMode`.
#[derive(Deserialize)]
struct UpdateChatConfigBody {
    #[serde(rename = "adapterId")]
    adapter_id: Option<String>,
    model: Option<String>,
    #[serde(rename = "permissionMode")]
    permission_mode: Option<ExecutionMode>,
    #[serde(rename = "planMode")]
    plan_mode: Option<bool>,
    /// A chat's project is fixed at creation. Detected as an explicit
    /// field (present at all, any value including `null`) rather than
    /// `deny_unknown_fields`, because other clients may send extra keys today.
    #[serde(
        rename = "projectId",
        default,
        deserialize_with = "mainframe_types::serde_util::double_option"
    )]
    project_id: Option<Option<serde_json::Value>>,
}

async fn update_config(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    // A non-object body or a bad permissionMode enum fails the parse → 400.
    let Some(cfg) = parse_body::<UpdateChatConfigBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    if cfg.project_id.is_some() {
        return fail(StatusCode::BAD_REQUEST, "projectId cannot be changed");
    }
    match chat_exists(&ctx, &id).await {
        Ok(false) => return crate::respond::ApiError::chat_not_found().into_response(),
        Ok(true) => {}
        Err(resp) => return resp.into_response(),
    }
    let cm = &ctx.chat.chat_manager;
    match cm
        .update_chat_config(
            &id,
            cfg.adapter_id,
            cfg.model,
            cfg.permission_mode,
            cfg.plan_mode,
        )
        .await
    {
        Ok(()) => match cm.get_chat(&id) {
            Some(chat) => ok(chat),
            None => crate::respond::ApiError::chat_not_found().into_response(),
        },
        Err(err) => crate::respond::fail_internal(
            format!("updateChatConfig failed chat_id={}", id),
            &err,
            err.to_string(),
        ),
    }
}

/// Shared command scaffold: 404 when the chat is unknown, else run + okEmpty.
async fn interrupt(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    match chat_exists(&ctx, &id).await {
        Ok(false) => return crate::respond::ApiError::chat_not_found().into_response(),
        Ok(true) => {}
        Err(resp) => return resp.into_response(),
    }
    let cm = &ctx.chat.chat_manager;
    cm.interrupt_chat(&id).await;
    ok_empty()
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResumeQuery {
    wait_for: Option<ResumeWaitFor>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ResumeWaitFor {
    Transcript,
}

#[cfg(test)]
#[path = "chat_commands_resume_tests.rs"]
mod resume_tests;

async fn resume(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(query): Query<ResumeQuery>,
) -> Response {
    match chat_exists(&ctx, &id).await {
        Ok(false) => return crate::respond::ApiError::chat_not_found().into_response(),
        Ok(true) => {}
        Err(resp) => return resp.into_response(),
    }
    let cm = &ctx.chat.chat_manager;
    if query.wait_for.is_some() {
        cm.resume_transcript(&id).await;
    } else {
        cm.resume_chat(&id).await;
    }
    ok_empty()
}

async fn trust_workspace(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    match chat_exists(&ctx, &id).await {
        Ok(false) => return crate::respond::ApiError::chat_not_found().into_response(),
        Ok(true) => {}
        Err(resp) => return resp.into_response(),
    }
    let cm = &ctx.chat.chat_manager;
    match cm.trust_workspace(&id).await {
        Ok(()) => ok_empty(),
        Err(err) => crate::respond::fail_domain(format!("trust-workspace failed id={id}"), &err),
    }
}

#[derive(Deserialize)]
struct QueueEditBody {
    content: Option<String>,
}

async fn queue_edit(
    State(ctx): State<Arc<AppCtx>>,
    Path((id, message_id)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    let Some(content) = parse_body::<QueueEditBody>(&body)
        .and_then(|b| b.content)
        .filter(|c| !c.is_empty())
    else {
        return fail(StatusCode::BAD_REQUEST, "content is required");
    };
    match chat_exists(&ctx, &id).await {
        Ok(false) => return crate::respond::ApiError::chat_not_found().into_response(),
        Ok(true) => {}
        Err(resp) => return resp.into_response(),
    }
    let cm = &ctx.chat.chat_manager;
    match cm.edit_queued_message(&id, &message_id, &content).await {
        Ok(()) => ok_empty(),
        Err(err) => crate::respond::fail_internal(
            format!("queue.edit failed chat_id={}", id),
            &err,
            err.to_string(),
        ),
    }
}

async fn queue_cancel(
    State(ctx): State<Arc<AppCtx>>,
    Path((id, message_id)): Path<(String, String)>,
) -> Response {
    match chat_exists(&ctx, &id).await {
        Ok(false) => return crate::respond::ApiError::chat_not_found().into_response(),
        Ok(true) => {}
        Err(resp) => return resp.into_response(),
    }
    let cm = &ctx.chat.chat_manager;
    match cm.cancel_queued_message(&id, &message_id).await {
        Ok(()) => ok_empty(),
        Err(err) => crate::respond::fail_internal(
            format!("queue.cancel failed chat_id={}", id),
            &err,
            err.to_string(),
        ),
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/chats/{id}/config", patch(update_config))
        .route("/api/chats/{id}/interrupt", post(interrupt))
        .route("/api/chats/{id}/resume", post(resume))
        .route("/api/chats/{id}/trust-workspace", post(trust_workspace))
        .route(
            "/api/chats/{id}/queue/{messageId}",
            patch(queue_edit).delete(queue_cancel),
        )
}

#[cfg(test)]
#[path = "chat_commands_tests.rs"]
mod tests;
