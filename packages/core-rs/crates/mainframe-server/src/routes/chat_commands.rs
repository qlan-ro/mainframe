//! Ported from `src/server/routes/chat-commands.ts` — chat create + config PATCH
//! + interrupt/resume/trust-workspace commands + queue edit/cancel.
//!
//! create (createChatWithDefaults), config PATCH (updateChatConfig),
//! interrupt/resume/trust-workspace and queue edit/cancel all port over the
//! `ChatManager` facade and are gated on the manager being wired. Existence is
//! checked against `ctx.db.chats` so 404s are honoured before the facade call.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{patch, post};
use serde::Deserialize;

use mainframe_types::settings::ExecutionMode;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};
use crate::routes::projects::parse_body;

async fn chat_exists(ctx: &Arc<AppCtx>, id: &str) -> Result<bool, Response> {
    let lookup = id.to_string();
    match ctx.db.call(move |db| db.chats.get(&lookup)).await {
        Ok(chat) => Ok(chat.is_some()),
        Err(err) => Err(crate::async_err::internal_error("get chat", &err)),
    }
}

#[derive(Deserialize)]
struct CreateChatBody {
    #[serde(rename = "projectId")]
    project_id: Option<String>,
    #[serde(rename = "adapterId")]
    adapter_id: Option<String>,
    model: Option<String>,
    #[serde(rename = "permissionMode")]
    permission_mode: Option<String>,
    #[serde(rename = "worktreePath")]
    worktree_path: Option<String>,
    #[serde(rename = "branchName")]
    branch_name: Option<String>,
}

async fn create(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let Some(b) = parse_body::<CreateChatBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let (Some(project_id), Some(adapter_id)) = (
        b.project_id.filter(|s| !s.is_empty()),
        b.adapter_id.filter(|s| !s.is_empty()),
    ) else {
        return fail(
            StatusCode::BAD_REQUEST,
            "projectId and adapterId are required",
        );
    };
    if b.worktree_path.is_none() != b.branch_name.is_none() {
        return fail(
            StatusCode::BAD_REQUEST,
            "worktreePath and branchName must be provided together",
        );
    }
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(%project_id, %adapter_id, "createChat is a Phase-4 seam (ChatManager unavailable)");
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "createChatWithDefaults unavailable",
        );
    };
    let chat = cm
        .create_chat_with_defaults(
            &project_id,
            &adapter_id,
            b.model.as_deref(),
            b.permission_mode.as_deref(),
            b.worktree_path.as_deref(),
            b.branch_name.as_deref(),
            None,
        )
        .await;
    ok(chat)
}

/// `UpdateChatConfigBody` (ws-schemas): every field optional; `permissionMode`
/// is `z.enum(EXECUTION_MODES)` (no `plan`), so it maps to `ExecutionMode`.
#[derive(Deserialize)]
struct UpdateChatConfigBody {
    #[serde(rename = "adapterId")]
    adapter_id: Option<String>,
    model: Option<String>,
    #[serde(rename = "permissionMode")]
    permission_mode: Option<ExecutionMode>,
    #[serde(rename = "planMode")]
    plan_mode: Option<bool>,
}

async fn update_config(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    // validate(UpdateChatConfigBody, ...): a non-object body or a bad
    // permissionMode enum fails the parse → 400, mirroring the TS Zod refine.
    let Some(cfg) = parse_body::<UpdateChatConfigBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    match chat_exists(&ctx, &id).await {
        Ok(false) => return fail(StatusCode::NOT_FOUND, "Chat not found"),
        Ok(true) => {}
        Err(resp) => return resp,
    }
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "updateChatConfig is a Phase-4 seam (ChatManager unavailable)");
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "updateChatConfig unavailable",
        );
    };
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
            None => fail(StatusCode::NOT_FOUND, "Chat not found"),
        },
        Err(err) => {
            tracing::error!(chat_id = %id, %err, "updateChatConfig failed");
            fail(StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
        }
    }
}

/// Shared command scaffold: 404 when the chat is unknown, else run + okEmpty.
async fn interrupt(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    match chat_exists(&ctx, &id).await {
        Ok(false) => return fail(StatusCode::NOT_FOUND, "Chat not found"),
        Ok(true) => {}
        Err(resp) => return resp,
    }
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "interrupt is a Phase-4 seam (ChatManager unavailable)");
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "interrupt unavailable");
    };
    cm.interrupt_chat(&id).await;
    ok_empty()
}

async fn resume(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    match chat_exists(&ctx, &id).await {
        Ok(false) => return fail(StatusCode::NOT_FOUND, "Chat not found"),
        Ok(true) => {}
        Err(resp) => return resp,
    }
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "resume is a Phase-4 seam (ChatManager unavailable)");
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "resume unavailable");
    };
    cm.resume_chat(&id).await;
    ok_empty()
}

async fn trust_workspace(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    match chat_exists(&ctx, &id).await {
        Ok(false) => return fail(StatusCode::NOT_FOUND, "Chat not found"),
        Ok(true) => {}
        Err(resp) => return resp,
    }
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "trustWorkspace is a Phase-4 seam (ChatManager unavailable)");
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "trustWorkspace unavailable",
        );
    };
    match cm.trust_workspace(&id).await {
        Ok(()) => ok_empty(),
        Err(err) => {
            tracing::error!(chat_id = %id, %err, "trust-workspace failed");
            fail(StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
        }
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
        Ok(false) => return fail(StatusCode::NOT_FOUND, "Chat not found"),
        Ok(true) => {}
        Err(resp) => return resp,
    }
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "queue.edit is a Phase-4 seam (ChatManager unavailable)");
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "queue.edit unavailable");
    };
    match cm.edit_queued_message(&id, &message_id, &content).await {
        Ok(()) => ok_empty(),
        Err(err) => {
            tracing::error!(chat_id = %id, %err, "queue.edit failed");
            fail(StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
        }
    }
}

async fn queue_cancel(
    State(ctx): State<Arc<AppCtx>>,
    Path((id, message_id)): Path<(String, String)>,
) -> Response {
    match chat_exists(&ctx, &id).await {
        Ok(false) => return fail(StatusCode::NOT_FOUND, "Chat not found"),
        Ok(true) => {}
        Err(resp) => return resp,
    }
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "queue.cancel is a Phase-4 seam (ChatManager unavailable)");
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "queue.cancel unavailable",
        );
    };
    match cm.cancel_queued_message(&id, &message_id).await {
        Ok(()) => ok_empty(),
        Err(err) => {
            tracing::error!(chat_id = %id, %err, "queue.cancel failed");
            fail(StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
        }
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/chats", post(create))
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
mod tests {
    use super::*;
    use axum::body::to_bytes;

    async fn read(resp: Response) -> (StatusCode, serde_json::Value) {
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    #[tokio::test]
    async fn create_rejects_missing_fields_400() {
        let ctx = AppCtx::test_ctx();
        let resp = create(
            State(ctx.clone()),
            axum::body::Bytes::from(r#"{"projectId":"p"}"#),
        )
        .await;
        assert_eq!(read(resp).await.0, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn create_rejects_worktree_without_branch_400() {
        let ctx = AppCtx::test_ctx();
        let resp = create(
            State(ctx.clone()),
            axum::body::Bytes::from(
                r#"{"projectId":"p","adapterId":"claude","worktreePath":"/wt"}"#,
            ),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(
            body["error"],
            "worktreePath and branchName must be provided together"
        );
    }

    #[tokio::test]
    async fn interrupt_missing_chat_404() {
        let ctx = AppCtx::test_ctx();
        let (status, body) = read(interrupt(State(ctx.clone()), Path("nope".into())).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "Chat not found");
    }

    #[tokio::test]
    async fn queue_edit_rejects_empty_content_400() {
        let ctx = AppCtx::test_ctx();
        let resp = queue_edit(
            State(ctx.clone()),
            Path(("c".into(), "m".into())),
            axum::body::Bytes::from(r#"{"content":""}"#),
        )
        .await;
        assert_eq!(read(resp).await.0, StatusCode::BAD_REQUEST);
    }
}

// PORT STATUS: src/server/routes/chat-commands.ts (7 endpoints, 96 lines)
// confidence: high
// todos: 0
// notes: create (createChatWithDefaults) + config PATCH (updateChatConfig) +
// interrupt/resume/trust-workspace/queue-edit/queue-cancel port over the
// ChatManager facade — all self-gate on ctx.chat_manager, wired at boot (Task
// 4.6c), so they are live. updateChatConfig parses UpdateChatConfigBody
// (permissionMode is z.enum(EXECUTION_MODES) → ExecutionMode, no `plan`),
// delegates to ChatManager.update_chat_config (chat_manager.rs), then returns
// ok(get_chat(id)), matching TS. trust-workspace now delegates to
// ChatManager::trust_workspace (writeWorkspaceTrust is ported in
// mainframe-adapter-claude::trust_store) — the db existence 404 is honoured
// first, then any chat/project-not-found or write error 500s with the error
// message, matching the TS route's try/catch. Zod enum/refine 400 messages are
// approximated; the both-or-neither worktree refine string matches TS.
