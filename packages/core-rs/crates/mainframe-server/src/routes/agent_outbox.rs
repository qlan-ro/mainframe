//! Messages the orchestration MCP server holds for a busy chat (`chat_send`
//! in queue mode, task results owed to a parent). The target's
//! `Chat.agentOutbox` lists them; the user can cancel one before delivery.
//!
//! - `DELETE /api/chats/{id}/agent-outbox/{entryId}` cancels one (404 when it
//!   is gone, e.g. already delivered).

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::delete;

use mainframe_orchestration::input::check_id;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok_empty};

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
    Router::new().route("/api/chats/{id}/agent-outbox/{entry_id}", delete(cancel))
}

#[cfg(test)]
mod tests {
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
}
