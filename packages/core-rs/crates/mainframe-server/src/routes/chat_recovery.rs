//! Ported from `src/server/routes/chat-recovery.ts`.
//!
//! Degraded-chat recovery routes — the actions behind the unified degraded-chat
//! card (missing transcript / missing worktree). All three re-emit an enriched
//! `chat.updated` via the ChatManager so clients clear the card live.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
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
    // The recovery ops are ChatManager-backed with no db fallback; when the
    // manager is unwired (Phase-3 harness) the route reports the seam.
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id, "chat recovery needs ChatManager (unwired)");
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "Operation failed");
    };
    if cm.get_chat(chat_id).is_none() {
        return fail(StatusCode::NOT_FOUND, "Chat not found");
    }
    let result = match action {
        RecoveryAction::RecreateWorktree => cm.recreate_worktree(chat_id).await,
        RecoveryAction::ContinueHere => cm.continue_here(chat_id).await,
        RecoveryAction::ContinueInProjectRoot => cm.continue_in_project_root(chat_id).await,
    };
    match result {
        Ok(()) => ok_empty(),
        Err(err) => {
            // Honor `err.statusCode` (recreateChatWorktree tags branch-gone 409),
            // else the default 400; the error message crosses the wire verbatim.
            let status = err
                .status_code()
                .and_then(|code| StatusCode::from_u16(code).ok())
                .unwrap_or(StatusCode::BAD_REQUEST);
            tracing::warn!(chat_id, %err, "{label} failed");
            fail(status, err.to_string())
        }
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
    use axum::body::to_bytes;

    async fn read(resp: Response) -> (StatusCode, serde_json::Value) {
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let body = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, body)
    }

    // Without a wired ChatManager the recovery ops have no db fallback, so every
    // route reports the seam (mirrors the other manager-backed routes). The
    // getChat-404, 409-branch-gone, and happy-path assertions from
    // chat-recovery.test.ts are covered by the degraded_recovery / chat_manager
    // oracle in mainframe-chat.
    #[tokio::test]
    async fn recovery_routes_report_the_seam_without_a_chat_manager() {
        let ctx = AppCtx::test_ctx();
        for action in [
            RecoveryAction::RecreateWorktree,
            RecoveryAction::ContinueHere,
            RecoveryAction::ContinueInProjectRoot,
        ] {
            let (status, body) = read(run(&ctx, "c1", action).await).await;
            assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
            assert_eq!(body["error"], "Operation failed");
        }
    }
}

// PORT STATUS: src/server/routes/chat-recovery.ts (3 POST routes)
// confidence: high
// todos: 0
// notes: Main catch-up (#424): new degraded-chat recovery routes
// (recreate-worktree / continue-here / continue-in-project-root) → okEmpty. The id
// param 404s an unknown chat before the action runs; a DegradedRecoveryError maps
// its status_code() (BranchGone → 409) else 400, with the Display message crossing
// the wire verbatim (as the TS `err.statusCode`/`err.message` pass-through does).
// ChatManager-backed with no db fallback, so the unwired harness reports the 500
// seam like the other Phase-4 routes.
