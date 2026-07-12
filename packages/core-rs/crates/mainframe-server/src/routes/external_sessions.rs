//! Ported from `src/server/routes/external-sessions.ts` — list + import external
//! CLI sessions.
//!
//! Both endpoints go through `ctx.chats.getExternalSessionService()`, which is not
//! yet on the Rust `ChatManager` facade (the external-session service is ported in
//! `mainframe-chat` but not exposed by the facade until the server-integration
//! phase). They validate their inputs 1:1 with the TS schemas, then Phase-4 seam
//! mirroring projects::remove.

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
use crate::routes::projects::parse_body;

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
    let _ = &ctx;
    tracing::warn!(%project_id, "external-sessions list is a Phase-4 seam (ChatManager.getExternalSessionService unavailable)");
    fail(
        StatusCode::INTERNAL_SERVER_ERROR,
        "external session service unavailable",
    )
}

#[derive(Deserialize)]
struct ImportBody {
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    #[serde(rename = "adapterId")]
    adapter_id: Option<String>,
}

fn session_id_ok(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

async fn import(
    State(ctx): State<Arc<AppCtx>>,
    Path(project_id): Path<String>,
    body: Bytes,
) -> Response {
    let ok_body = parse_body::<ImportBody>(&body).filter(|b| {
        b.session_id.as_deref().map(session_id_ok).unwrap_or(false)
            && b.adapter_id
                .as_deref()
                .map(|a| !a.is_empty())
                .unwrap_or(false)
    });
    if ok_body.is_none() {
        tracing::warn!(%project_id, "invalid import request body");
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    }
    let _ = &ctx;
    tracing::warn!(%project_id, "external-sessions import is a Phase-4 seam (ChatManager.getExternalSessionService unavailable)");
    fail(
        StatusCode::INTERNAL_SERVER_ERROR,
        "external session service unavailable",
    )
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
    async fn list_valid_query_seams_500() {
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
        assert_eq!(read(resp).await.0, StatusCode::INTERNAL_SERVER_ERROR);
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
}

// PORT STATUS: src/server/routes/external-sessions.ts (2 endpoints, 65 lines)
// confidence: medium
// todos: 2
// notes: Both endpoints need ctx.chats.getExternalSessionService(), not yet on the
// Rust ChatManager facade → Phase-4 seams mirroring projects::remove. Query/body
// validation (offset>=0, limit 0..=200, sessionId [a-zA-Z0-9-]+, adapterId min1)
// ports 1:1; datetime validation on createdAt/modifiedAt is omitted (unused before
// the seam). See blockers.
