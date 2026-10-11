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
use crate::routes::body::parse_body;

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
    let cm = &ctx.chat.chat_manager;
    match cm.accept_worktree_offer(&id, &path).await {
        Ok(()) => ok_empty(),
        Err(err) => {
            crate::respond::fail_domain(format!("accept-worktree-offer failed chat_id={id}"), &err)
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
    let cm = &ctx.chat.chat_manager;
    match cm.dismiss_worktree_offer(&id, &path) {
        Ok(()) => ok_empty(),
        Err(err) => {
            crate::respond::fail_domain(format!("dismiss-worktree-offer failed chat_id={id}"), &err)
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
    async fn accept_and_dismiss_reject_an_offer_that_is_not_pending() {
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
        assert_eq!(accept_status, StatusCode::BAD_REQUEST);
        assert_eq!(
            accept_body["error"],
            "No pending worktree offer for that path"
        );

        let (dismiss_status, dismiss_body) = read(
            dismiss_worktree_offer(
                State(ctx.clone()),
                Path("c".into()),
                axum::body::Bytes::from(r#"{"worktreePath":"/tmp/wt"}"#),
            )
            .await,
        )
        .await;
        assert_eq!(dismiss_status, StatusCode::BAD_REQUEST);
        assert_eq!(
            dismiss_body["error"],
            "No pending worktree offer for that path"
        );
    }
}
