//! Accept or dismiss a pending worktree switch offer.
//!
//! Neither handler emits `worktree_offer:resolved` — the registry does, off the
//! binding change, so a manual attach through the popover resolves identically.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;
use serde::Deserialize;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok_empty};
use crate::routes::projects::parse_body;

#[derive(Deserialize)]
struct OfferBody {
    #[serde(rename = "worktreePath")]
    worktree_path: Option<String>,
}

const MISSING_PATH: &str = "Worktree path is required";

/// Shared so both handlers accept exactly the same bodies.
fn worktree_path(body: &Bytes) -> Option<String> {
    parse_body::<OfferBody>(body)
        .unwrap_or(OfferBody {
            worktree_path: None,
        })
        .worktree_path
        .filter(|path| !path.is_empty())
}

async fn accept_worktree_offer(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let Some(path) = worktree_path(&body) else {
        return fail(StatusCode::BAD_REQUEST, MISSING_PATH);
    };
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "accept-worktree-offer needs ChatManager (unwired)");
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to switch worktree",
        );
    };
    match cm.accept_worktree_offer(&id, &path).await {
        Ok(()) => ok_empty(),
        Err(err) => {
            let status = StatusCode::from_u16(err.status_code())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            tracing::warn!(chat_id = %id, %err, "accept-worktree-offer failed");
            fail(status, err.to_string())
        }
    }
}

async fn dismiss_worktree_offer(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let Some(path) = worktree_path(&body) else {
        return fail(StatusCode::BAD_REQUEST, MISSING_PATH);
    };
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "dismiss-worktree-offer needs ChatManager (unwired)");
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to switch worktree",
        );
    };
    match cm.dismiss_worktree_offer(&id, &path) {
        Ok(()) => ok_empty(),
        Err(err) => {
            let status = StatusCode::from_u16(err.status_code())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            tracing::warn!(chat_id = %id, %err, "dismiss-worktree-offer failed");
            fail(status, err.to_string())
        }
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route(
            "/api/chats/{id}/accept-worktree-offer",
            post(accept_worktree_offer),
        )
        .route(
            "/api/chats/{id}/dismiss-worktree-offer",
            post(dismiss_worktree_offer),
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
    async fn accept_rejects_empty_body_400() {
        let ctx = AppCtx::test_ctx();
        let resp = accept_worktree_offer(
            State(ctx.clone()),
            Path("c".into()),
            axum::body::Bytes::from(""),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "Worktree path is required");
    }

    #[tokio::test]
    async fn accept_rejects_empty_worktree_path_400() {
        let ctx = AppCtx::test_ctx();
        let resp = accept_worktree_offer(
            State(ctx.clone()),
            Path("c".into()),
            axum::body::Bytes::from(r#"{"worktreePath":""}"#),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "Worktree path is required");
    }

    #[tokio::test]
    async fn dismiss_rejects_empty_body_400() {
        let ctx = AppCtx::test_ctx();
        let resp = dismiss_worktree_offer(
            State(ctx.clone()),
            Path("c".into()),
            axum::body::Bytes::from(""),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "Worktree path is required");
    }

    #[tokio::test]
    async fn accept_and_dismiss_fail_with_unwired_chat_manager_500() {
        let ctx = AppCtx::test_ctx();
        let (accept_status, accept_body) = read(
            accept_worktree_offer(
                State(ctx.clone()),
                Path("c".into()),
                axum::body::Bytes::from(r#"{"worktreePath":"/tmp/wt"}"#),
            )
            .await,
        )
        .await;
        assert_eq!(accept_status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(accept_body["error"], "Failed to switch worktree");

        let (dismiss_status, dismiss_body) = read(
            dismiss_worktree_offer(
                State(ctx.clone()),
                Path("c".into()),
                axum::body::Bytes::from(r#"{"worktreePath":"/tmp/wt"}"#),
            )
            .await,
        )
        .await;
        assert_eq!(dismiss_status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(dismiss_body["error"], "Failed to switch worktree");
    }
}
