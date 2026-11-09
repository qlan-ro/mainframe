//! `POST /api/chats/{id}/native-session/unarchive`: unarchive the chat's
//! provider session after a send failed because the provider archived it (a
//! Codex thread archived in the Codex app). The client retries the send after.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::post;

use crate::ctx::AppCtx;
use crate::respond::ok_empty;

async fn unarchive(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Response, crate::respond::ApiError> {
    ctx.require_chat(&id).await?;
    ctx.chat.chat_manager.unarchive_native_session(&id).await?;
    Ok(ok_empty())
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/chats/{id}/native-session/unarchive", post(unarchive))
}

#[cfg(test)]
#[path = "chat_native_session_tests.rs"]
mod tests;
