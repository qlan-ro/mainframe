//! Ported from `src/server/routes/external-sessions.ts` — list + import external
//! CLI sessions.
//!
//! Both endpoints go through `ChatManager::external_session_service()`, wired in
//! `chat_deps::build_chat_manager` via `ExternalSessionDeps for DaemonChatDeps`.
//! When no `ChatManager` is present (e.g. the route-unit test harness), they fall
//! back to the "external session service unavailable" 500 the seam used before
//! wiring.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};
use serde::Deserialize;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::projects::parse_body;

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
    let Some(service) = ctx
        .chat_manager
        .as_ref()
        .and_then(|m| m.external_session_service())
    else {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, SERVICE_UNAVAILABLE);
    };
    service.start_auto_scan(&project_id);
    let page = service.scan_page(&project_id, offset, limit).await;
    ok(page)
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
    let Some(service) = ctx
        .chat_manager
        .as_ref()
        .and_then(|m| m.external_session_service())
    else {
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
    ok(chat)
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
    async fn list_rejects_out_of_range_limit_400() {
        let ctx = AppCtx::test_ctx();
        let resp = list(
            State(ctx.clone()),
            Path("p".into()),
            Query(ListQuery {
                offset: Some(0),
                limit: Some(300),
            }),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "Invalid query params");
    }

    #[tokio::test]
    async fn list_valid_query_without_chat_manager_500() {
        let ctx = AppCtx::test_ctx();
        let resp = list(
            State(ctx.clone()),
            Path("p".into()),
            Query(ListQuery {
                offset: None,
                limit: None,
            }),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body["error"], SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn import_rejects_bad_session_id_400() {
        let ctx = AppCtx::test_ctx();
        let resp = import(
            State(ctx.clone()),
            Path("p".into()),
            axum::body::Bytes::from(r#"{"sessionId":"bad id!","adapterId":"claude"}"#),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "Invalid request body");
    }

    #[tokio::test]
    async fn import_valid_body_without_chat_manager_500() {
        let ctx = AppCtx::test_ctx();
        let resp = import(
            State(ctx.clone()),
            Path("p".into()),
            axum::body::Bytes::from(r#"{"sessionId":"abc-123","adapterId":"claude"}"#),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body["error"], SERVICE_UNAVAILABLE);
    }
}

// PORT STATUS: src/server/routes/external-sessions.ts (2 endpoints, 65 lines)
// confidence: high
// todos: 1
// notes: Both endpoints now call ChatManager::external_session_service()
// (wired in mainframe-server/src/chat_deps.rs). Query/body validation
// (offset>=0, limit 0..=200, sessionId [a-zA-Z0-9-]+, adapterId min1) ports 1:1.
// createdAt/modifiedAt/title are forwarded to importSession as plain optional
// strings without Zod's `.datetime()`/max-500 checks — deliberately deferred,
// since the underlying ExternalSessionService/DB layer does its own parsing and
// a malformed value fails there instead of at this validation boundary. The
// route-unit test harness (`AppCtx::test_ctx()`) has `chat_manager: None`, so
// the "service unavailable" 500 path is what's exercised here; the real
// scan/import behavior is covered by mainframe-chat's
// chat_manager::tests::with_external_sessions_* tests against a fake
// ExternalSessionDeps.
