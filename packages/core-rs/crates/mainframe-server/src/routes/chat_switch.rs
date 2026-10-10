//! Provider switching: `POST /api/chats/{id}/switch-provider` continues a chat
//! on another provider, and `GET /api/chats/{id}/segments` lists its provider
//! segments. `ChatManager::switch_provider` owns the refusal table; this
//! module only validates the request and maps errors to statuses.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};

use mainframe_types::segment::SwitchProviderRequest;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::projects::parse_body;

#[cfg(test)]
mod tests;

async fn switch_provider(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    if !mainframe_types::ids::is_safe_identifier(&id) {
        return fail(StatusCode::BAD_REQUEST, "Invalid chat id");
    }
    let Some(req) = parse_body::<SwitchProviderRequest>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    if !mainframe_types::ids::is_safe_identifier(&req.adapter_id) {
        return fail(StatusCode::BAD_REQUEST, "Invalid adapterId");
    }
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "switch_provider needs ChatManager (unwired)");
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "provider switch unavailable",
        );
    };
    match cm.switch_provider(&id, &req).await {
        Ok(chat) => ok(chat),
        Err(err) => {
            let status =
                StatusCode::from_u16(err.status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            if status == StatusCode::INTERNAL_SERVER_ERROR {
                tracing::error!(chat_id = %id, %err, "provider switch failed");
            }
            fail(status, err.to_string())
        }
    }
}

async fn list_segments(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    if !mainframe_types::ids::is_safe_identifier(&id) {
        return fail(StatusCode::BAD_REQUEST, "Invalid chat id");
    }
    let lookup = id.clone();
    let result = ctx
        .db
        .call(move |db| match db.chats.get(&lookup)? {
            Some(_) => db.segments.list_wire(&lookup).map(Some),
            None => Ok(None),
        })
        .await;
    match result {
        Ok(Some(segments)) => ok(segments),
        Ok(None) => fail(StatusCode::NOT_FOUND, format!("Chat {id} not found")),
        Err(err) => crate::async_err::internal_error("list segments", &err),
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/chats/{id}/switch-provider", post(switch_provider))
        .route("/api/chats/{id}/segments", get(list_segments))
}
