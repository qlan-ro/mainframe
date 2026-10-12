//! Degraded-chat recovery routes — the actions behind the unified degraded-chat
//! card (missing transcript / missing worktree). All three re-emit an enriched
//! `chat.updated` via the ChatManager so clients clear the card live.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok_empty};

/// Which recovery op a route runs, mapped to its ChatManager method + log label.
#[derive(Clone, Copy)]
enum RecoveryAction {
    RecreateWorktree,
    ContinueHere,
    ContinueInProjectRoot,
}

impl RecoveryAction {
    fn label(self) -> &'static str {
        match self {
            RecoveryAction::RecreateWorktree => "recreate worktree",
            RecoveryAction::ContinueHere => "continue here",
            RecoveryAction::ContinueInProjectRoot => "continue in project root",
        }
    }
}

async fn run(ctx: &Arc<AppCtx>, chat_id: &str, action: RecoveryAction) -> Response {
    if chat_id.is_empty() {
        return fail(
            StatusCode::BAD_REQUEST,
            "Too small: expected string to have >=1 characters",
        );
    }
    let label = action.label();
    let cm = &ctx.chat.chat_manager;
    if cm.get_chat(chat_id).is_none() {
        return crate::respond::ApiError::chat_not_found().into_response();
    }
    let result = match action {
        RecoveryAction::RecreateWorktree => cm.recreate_worktree(chat_id).await,
        RecoveryAction::ContinueHere => cm.continue_here(chat_id).await,
        RecoveryAction::ContinueInProjectRoot => cm.continue_in_project_root(chat_id).await,
    };
    match result {
        Ok(()) => ok_empty(),
        Err(err) => crate::respond::fail_domain(format!("{label} failed chat_id={chat_id}"), &err),
    }
}

async fn recreate_worktree(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    run(&ctx, &id, RecoveryAction::RecreateWorktree).await
}

async fn continue_here(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    run(&ctx, &id, RecoveryAction::ContinueHere).await
}

async fn continue_in_project_root(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Response {
    run(&ctx, &id, RecoveryAction::ContinueInProjectRoot).await
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/chats/{id}/recreate-worktree", post(recreate_worktree))
        .route("/api/chats/{id}/continue-here", post(continue_here))
        .route(
            "/api/chats/{id}/continue-in-project-root",
            post(continue_in_project_root),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::test_support::read_json as read;

    #[tokio::test]
    async fn recovery_routes_report_missing_chat() {
        let ctx = AppCtx::test_ctx();
        for action in [
            RecoveryAction::RecreateWorktree,
            RecoveryAction::ContinueHere,
            RecoveryAction::ContinueInProjectRoot,
        ] {
            let (status, body) = read(run(&ctx, "c1", action).await).await.unwrap();
            assert_eq!(status, StatusCode::NOT_FOUND);
            assert_eq!(body["error"], "Chat not found");
        }
    }
}
