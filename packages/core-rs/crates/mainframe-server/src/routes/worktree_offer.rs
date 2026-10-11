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
#[path = "worktree_offer_tests.rs"]
mod tests;
