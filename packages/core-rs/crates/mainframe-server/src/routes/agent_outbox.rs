//! Messages the orchestration MCP server holds for a busy chat (`chat_send`
//! in queue mode, task results owed to a parent). The user can see them and
//! cancel one before it is delivered.
//!
//! - `GET /api/chats/{id}/agent-outbox` lists `{entryId, fromChatId, preview}`.
//! - `DELETE /api/chats/{id}/agent-outbox/{entryId}` cancels one (404 when it
//!   is gone, e.g. already delivered).

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{delete, get};
use serde_json::json;

use mainframe_orchestration::input::check_id;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};

async fn list(State(ctx): State<Arc<AppCtx>>, Path(chat_id): Path<String>) -> Response {
    if check_id("chatId", &chat_id).is_err() {
        return fail(StatusCode::BAD_REQUEST, "Invalid chat id");
    }
    let Some(service) = ctx.orchestration.as_ref() else {
        return fail(StatusCode::SERVICE_UNAVAILABLE, "orchestration unavailable");
    };
    let entries: Vec<_> = service
        .outbox_entries(&chat_id)
        .into_iter()
        .map(|e| json!({ "entryId": e.entry_id, "fromChatId": e.from_chat_id, "preview": e.preview }))
        .collect();
    ok(entries)
}

async fn cancel(
    State(ctx): State<Arc<AppCtx>>,
    Path((chat_id, entry_id)): Path<(String, String)>,
) -> Response {
    if check_id("chatId", &chat_id).is_err() || check_id("entryId", &entry_id).is_err() {
        return fail(StatusCode::BAD_REQUEST, "Invalid id");
    }
    let Some(service) = ctx.orchestration.as_ref() else {
        return fail(StatusCode::SERVICE_UNAVAILABLE, "orchestration unavailable");
    };
    if service.cancel_outbox_entry(&chat_id, &entry_id).await {
        ok_empty()
    } else {
        fail(StatusCode::NOT_FOUND, "No such pending message")
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/chats/{id}/agent-outbox", get(list))
        .route("/api/chats/{id}/agent-outbox/{entry_id}", delete(cancel))
}

#[cfg(test)]
mod tests {
    use axum::body::to_bytes;

    use super::*;

    #[tokio::test]
    async fn cancel_validates_ids_and_answers_404_for_a_missing_entry() {
        let ctx = AppCtx::test_ctx_with_orchestration();
        let bad = cancel(
            State(Arc::clone(&ctx)),
            Path(("../x".to_string(), "ob1".to_string())),
        )
        .await;
        assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
        let missing = cancel(
            State(Arc::clone(&ctx)),
            Path(("chat1".to_string(), "ob1".to_string())),
        )
        .await;
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn list_returns_the_held_entries() {
        let ctx = AppCtx::test_ctx_with_orchestration();
        let resp = list(State(Arc::clone(&ctx)), Path("chat1".to_string())).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = to_bytes(resp.into_body(), 1 << 16).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["data"], json!([]));
    }
}
