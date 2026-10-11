//! Lists and imports CLI sessions through ChatManager external-session services.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};
use serde::Deserialize;

use crate::ctx::AppCtx;
use crate::respond::fail;
use crate::routes::body::parse_body;

const SERVICE_UNAVAILABLE: &str = "external session service unavailable";

#[derive(Deserialize)]
struct ListQuery {
    offset: Option<i64>,
    limit: Option<i64>,
}

async fn list(
    State(ctx): State<Arc<AppCtx>>,
    Path(project_id): Path<String>,
    Query(q): Query<ListQuery>,
) -> Response {
    let offset = q.offset.unwrap_or(0);
    let limit = q.limit.unwrap_or(50);
    if offset < 0 || !(0..=200).contains(&limit) {
        tracing::warn!(%project_id, "invalid external-sessions query");
        return fail(StatusCode::BAD_REQUEST, "Invalid query params");
    }
    let Some(service) = ctx.chat.chat_manager.external_session_service() else {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, SERVICE_UNAVAILABLE);
    };
    service.start_auto_scan(&project_id);
    let page = service.scan_page(&project_id, offset, limit).await;
    crate::respond::storage(page)
}

#[derive(Deserialize)]
struct ImportBody {
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    #[serde(rename = "adapterId")]
    adapter_id: Option<String>,
    title: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: Option<String>,
    #[serde(rename = "modifiedAt")]
    modified_at: Option<String>,
}

fn session_id_ok(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Returns `(session_id, adapter_id)` if both required fields pass validation.
fn validate_import(body: &ImportBody) -> Option<(String, String)> {
    let session_id = body.session_id.as_deref().filter(|s| session_id_ok(s))?;
    let adapter_id = body.adapter_id.as_deref().filter(|a| !a.is_empty())?;
    Some((session_id.to_string(), adapter_id.to_string()))
}

async fn import(
    State(ctx): State<Arc<AppCtx>>,
    Path(project_id): Path<String>,
    body: Bytes,
) -> Response {
    let Some(body) = parse_body::<ImportBody>(&body) else {
        tracing::warn!(%project_id, "invalid import request body");
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let Some((session_id, adapter_id)) = validate_import(&body) else {
        tracing::warn!(%project_id, "invalid import request body");
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let Some(service) = ctx.chat.chat_manager.external_session_service() else {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, SERVICE_UNAVAILABLE);
    };
    let chat = service
        .import_session(
            &project_id,
            &session_id,
            &adapter_id,
            body.title.as_deref(),
            body.created_at.as_deref(),
            body.modified_at.as_deref(),
        )
        .await;
    crate::respond::storage(chat)
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/projects/{projectId}/external-sessions", get(list))
        .route(
            "/api/projects/{projectId}/external-sessions/import",
            post(import),
        )
}

#[cfg(test)]
#[path = "external_sessions_tests.rs"]
mod tests;
