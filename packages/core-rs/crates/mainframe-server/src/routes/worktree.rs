//! Ported from `src/server/routes/worktree.ts` — worktree enable/disable/fork/
//! attach, list, and delete.
//!
//! `GET /api/projects/:id/git/worktrees` ports fully (db project lookup +
//! `mainframe_services::workspace::get_worktrees`). The five mutating endpoints
//! (enable/disable/fork/attach/delete) go through ChatManager worktree methods
//! that live on the config/lifecycle managers and are not yet on the Rust
//! ChatManager facade (they land in the server-integration phase), so they
//! validate their inputs 1:1 and Phase-4 seam mirroring projects::remove.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};
use serde::Deserialize;

use mainframe_services::workspace::get_worktrees;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::projects::parse_body;

/// `branchNameSchema`: non-empty, `^[a-zA-Z0-9][a-zA-Z0-9._/-]*$`, no `..`.
fn branch_name_ok(name: &str) -> bool {
    if name.is_empty() || name.contains("..") {
        return false;
    }
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '/' | '-'))
}

// The `Err` carries a built axum `Response` (intentionally large); boxing it
// would only add an allocation for a value we return by move once.
#[allow(clippy::result_large_err)]
async fn project_path(ctx: &Arc<AppCtx>, project_id: &str) -> Result<Option<String>, Response> {
    let pid = project_id.to_string();
    match ctx.db.call(move |db| db.projects.get(&pid)).await {
        Ok(project) => Ok(project.map(|p| p.path)),
        Err(err) => Err(crate::async_err::internal_error("get project", &err)),
    }
}

#[derive(Deserialize)]
struct WorktreeBody {
    #[serde(rename = "baseBranch")]
    base_branch: Option<String>,
    #[serde(rename = "branchName")]
    branch_name: Option<String>,
}

#[allow(clippy::result_large_err)]
fn validate_enable_fork(body: &Bytes) -> Result<(), Response> {
    let Some(b) = parse_body::<WorktreeBody>(body) else {
        return Err(fail(StatusCode::BAD_REQUEST, "Invalid input"));
    };
    if b.base_branch
        .as_deref()
        .map(|s| s.is_empty())
        .unwrap_or(true)
    {
        return Err(fail(StatusCode::BAD_REQUEST, "Base branch is required"));
    }
    match b.branch_name.as_deref() {
        Some(name) if branch_name_ok(name) => Ok(()),
        Some("") => Err(fail(StatusCode::BAD_REQUEST, "Branch name is required")),
        _ => Err(fail(StatusCode::BAD_REQUEST, "Invalid branch name")),
    }
}

async fn enable_worktree(
    State(_ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    if let Err(resp) = validate_enable_fork(&body) {
        return resp;
    }
    tracing::warn!(chat_id = %id, "enable-worktree is a Phase-4 seam (ChatManager.enableWorktree unavailable)");
    fail(StatusCode::BAD_REQUEST, "enableWorktree unavailable")
}

async fn disable_worktree(State(_ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    tracing::warn!(chat_id = %id, "disable-worktree is a Phase-4 seam (ChatManager.disableWorktree unavailable)");
    fail(StatusCode::BAD_REQUEST, "disableWorktree unavailable")
}

async fn fork_worktree(
    State(_ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    if let Err(resp) = validate_enable_fork(&body) {
        return resp;
    }
    tracing::warn!(chat_id = %id, "fork-worktree is a Phase-4 seam (ChatManager.forkToWorktree unavailable)");
    fail(
        StatusCode::INTERNAL_SERVER_ERROR,
        "forkToWorktree unavailable",
    )
}

async fn list_worktrees(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let path = match project_path(&ctx, &id).await {
        Ok(Some(path)) => path,
        Ok(None) => return fail(StatusCode::NOT_FOUND, "Project not found"),
        Err(resp) => return resp,
    };
    let worktrees = get_worktrees(&path).await;
    let filtered: Vec<_> = worktrees.into_iter().filter(|wt| wt.path != path).collect();
    ok(serde_json::json!({ "worktrees": filtered }))
}

#[derive(Deserialize)]
struct AttachBody {
    #[serde(rename = "worktreePath")]
    worktree_path: Option<String>,
    #[serde(rename = "branchName")]
    branch_name: Option<String>,
}

async fn attach_worktree(
    State(_ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let valid = parse_body::<AttachBody>(&body).is_some_and(|b| {
        b.worktree_path
            .as_deref()
            .map(|s| !s.is_empty())
            .unwrap_or(false)
            && b.branch_name
                .as_deref()
                .map(|s| !s.is_empty())
                .unwrap_or(false)
    });
    if !valid {
        return fail(StatusCode::BAD_REQUEST, "Worktree path is required");
    }
    tracing::warn!(chat_id = %id, "attach-worktree is a Phase-4 seam (ChatManager.attachWorktree unavailable)");
    fail(StatusCode::BAD_REQUEST, "attachWorktree unavailable")
}

#[derive(Deserialize)]
struct DeleteWorktreeBody {
    #[serde(rename = "worktreePath")]
    worktree_path: Option<String>,
}

async fn delete_worktree(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    match project_path(&ctx, &id).await {
        Ok(Some(_)) => {}
        Ok(None) => return fail(StatusCode::NOT_FOUND, "Project not found"),
        Err(resp) => return resp,
    }
    let valid = parse_body::<DeleteWorktreeBody>(&body).is_some_and(|b| {
        b.worktree_path
            .as_deref()
            .map(|s| !s.is_empty())
            .unwrap_or(false)
    });
    if !valid {
        return fail(StatusCode::BAD_REQUEST, "Invalid input");
    }
    // TODO(port-phase4): validateAndDeleteWorktree + killTasksForChat + removeWorktree
    // is largely portable, but its final ctx.chats.notifyWorktreeDeleted() needs a
    // ChatManager facade method not yet ported. Seam mirroring projects::remove.
    tracing::warn!(project_id = %id, "delete-worktree is a Phase-4 seam (ChatManager.notifyWorktreeDeleted unavailable)");
    fail(StatusCode::BAD_REQUEST, "Failed to delete worktree")
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/chats/{id}/enable-worktree", post(enable_worktree))
        .route("/api/chats/{id}/disable-worktree", post(disable_worktree))
        .route("/api/chats/{id}/fork-worktree", post(fork_worktree))
        .route("/api/projects/{id}/git/worktrees", get(list_worktrees))
        .route("/api/chats/{id}/attach-worktree", post(attach_worktree))
        .route(
            "/api/projects/{id}/git/delete-worktree",
            post(delete_worktree),
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
    async fn list_worktrees_missing_project_404() {
        let ctx = AppCtx::test_ctx();
        let (status, body) =
            read(list_worktrees(State(ctx.clone()), Path("nope".into())).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "Project not found");
    }

    #[tokio::test]
    async fn enable_rejects_missing_base_branch_400() {
        let ctx = AppCtx::test_ctx();
        let resp = enable_worktree(
            State(ctx.clone()),
            Path("c".into()),
            axum::body::Bytes::from(r#"{"branchName":"feat"}"#),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "Base branch is required");
    }

    #[tokio::test]
    async fn enable_rejects_bad_branch_name_400() {
        let ctx = AppCtx::test_ctx();
        let resp = enable_worktree(
            State(ctx.clone()),
            Path("c".into()),
            axum::body::Bytes::from(r#"{"baseBranch":"main","branchName":"../evil"}"#),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "Invalid branch name");
    }

    #[test]
    fn branch_name_validation() {
        assert!(branch_name_ok("feature/x-1.2_y"));
        assert!(!branch_name_ok("../escape"));
        assert!(!branch_name_ok("-leading"));
        assert!(!branch_name_ok(""));
    }
}

// PORT STATUS: src/server/routes/worktree.ts (6 endpoints, 224 lines)
// confidence: medium
// todos: 5
// notes: GET /api/projects/:id/git/worktrees ports fully over db.projects +
// mainframe_services::workspace::get_worktrees (filtering the main worktree).
// enable/disable/fork/attach/delete need ChatManager worktree methods (enableWorktree
// /disableWorktree/attachWorktree on the config manager, forkToWorktree on the
// lifecycle manager, notifyWorktreeDeleted on the facade) not yet on the Rust
// ChatManager → Phase-4 seams after input validation. delete-worktree's
// validate+kill+removeWorktree body is portable except the trailing
// notifyWorktreeDeleted; deferred whole. See blockers.
