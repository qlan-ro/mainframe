//! `POST /api/chats/{id}/side-chat` — open or reveal a chat's side chat. See
//! `chat_manager::open_side_chat` for the daemon-side orchestration this route
//! only translates to the wire envelope.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;
use serde::Deserialize;

use mainframe_chat::chat_manager::OpenSideChatError;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::identifier::is_identifier;
use crate::routes::projects::parse_body;

#[cfg(test)]
mod tests;

/// The body is optional; when present it must be an empty JSON object — an
/// unknown field 400s rather than being silently ignored.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OpenSideChatBody {}

fn status_for(err: &OpenSideChatError) -> StatusCode {
    StatusCode::from_u16(err.status_code()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
}

async fn open_side_chat(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    if !is_identifier(&id) {
        return fail(StatusCode::BAD_REQUEST, "Invalid chat id");
    }
    if parse_body::<OpenSideChatBody>(&body).is_none() {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    }
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "open_side_chat needs ChatManager (unwired)");
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "side chat unavailable");
    };
    match cm.open_side_chat(&id).await {
        Ok(chat) => ok(chat),
        Err(err) => {
            let status = status_for(&err);
            if status == StatusCode::INTERNAL_SERVER_ERROR {
                tracing::error!(chat_id = %id, %err, "open_side_chat failed");
            }
            fail(status, err.to_string())
        }
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/chats/{id}/side-chat", post(open_side_chat))
}
