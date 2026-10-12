//! `POST /api/chats/{id}/discard`, and the temporary-chat refusal shared by the
//! pin/tag/archive/unarchive guards.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;

use mainframe_types::chat::Chat;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok_empty};

/// Pin, tags, archive and unarchive all refuse a temporary chat with
/// the same `fail` (409) envelope and leave it unchanged. `action` names the
/// refused verb for the message (e.g. "pin", "archive").
pub(crate) fn refuse_if_temporary(chat: &Chat, action: &str) -> Option<Response> {
    chat.temporary.then(|| {
        fail(
            StatusCode::CONFLICT,
            format!("cannot {action} a temporary chat"),
        )
    })
}

async fn discard(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Response, crate::respond::ApiError> {
    let chat = ctx.require_chat(&id).await?;
    if !chat.temporary {
        return Err(crate::respond::ApiError::Conflict(
            "chat is not temporary".into(),
        ));
    }
    ctx.chat.chat_manager.discard_chat(&id).await?;
    Ok(ok_empty())
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/chats/{id}/discard", post(discard))
}

#[cfg(test)]
#[path = "chat_discard_tests.rs"]
mod tests;
