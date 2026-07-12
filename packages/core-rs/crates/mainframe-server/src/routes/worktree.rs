//! Ported from `src/server/routes/worktree.ts` — worktree enable/disable/fork/
//! attach, list, and delete.
//!
//! `GET /api/projects/:id/git/worktrees` ports fully (db project lookup +
//! `mainframe_services::workspace::get_worktrees`). The five mutating endpoints go
//! through real ChatManager facade methods (enable/attach/disable on the config
//! manager, forkToWorktree = lifecycle + config, delete via the ported
//! `validateAndDeleteWorktree` + notifyWorktreeDeleted). When the ChatManager is
//! unwired (Phase-3 harness) they fall back to the failure-path envelope after
//! validating inputs 1:1.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};
use serde::Deserialize;

use mainframe_adapter_api::{AdapterSession, BoxFuture};
use mainframe_background_tasks::kill::{
    KillTasksForChatArgs, SessionLike, StopResult, kill_tasks_for_chat,
};
use mainframe_services::workspace::{get_worktrees, remove_worktree};

use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};
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

// Parse + validate the enable/fork body, returning the (baseBranch, branchName)
// pair. Mirrors `EnableWorktreeBody`/`ForkWorktreeBody` (first failing issue wins).
#[allow(clippy::result_large_err)]
fn validate_enable_fork(body: &Bytes) -> Result<(String, String), Response> {
    let Some(b) = parse_body::<WorktreeBody>(body) else {
        return Err(fail(StatusCode::BAD_REQUEST, "Invalid input"));
    };
    let Some(base) = b.base_branch.filter(|s| !s.is_empty()) else {
        return Err(fail(StatusCode::BAD_REQUEST, "Base branch is required"));
    };
    match b.branch_name.as_deref() {
        Some(name) if branch_name_ok(name) => Ok((base, name.to_string())),
        Some("") | None => Err(fail(StatusCode::BAD_REQUEST, "Branch name is required")),
        _ => Err(fail(StatusCode::BAD_REQUEST, "Invalid branch name")),
    }
}

async fn enable_worktree(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let (base, branch) = match validate_enable_fork(&body) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "enable-worktree needs ChatManager (unwired)");
        return fail(StatusCode::BAD_REQUEST, "Failed to enable worktree");
    };
    match cm.enable_worktree(&id, &base, &branch).await {
        Ok(()) => ok_empty(),
        Err(err) => {
            tracing::warn!(chat_id = %id, %err, "enable-worktree failed");
            fail(StatusCode::BAD_REQUEST, err.to_string())
        }
    }
}

async fn disable_worktree(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "disable-worktree needs ChatManager (unwired)");
        return fail(StatusCode::BAD_REQUEST, "Failed to disable worktree");
    };
    match cm.disable_worktree(&id).await {
        Ok(()) => ok_empty(),
        Err(err) => {
            tracing::warn!(chat_id = %id, %err, "disable-worktree failed");
            fail(StatusCode::BAD_REQUEST, err.to_string())
        }
    }
}

async fn fork_worktree(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let (base, branch) = match validate_enable_fork(&body) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "fork-worktree needs ChatManager (unwired)");
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to fork to worktree",
        );
    };
    match cm.fork_to_worktree(&id, &base, &branch).await {
        Ok(new_chat_id) => ok(serde_json::json!({ "chatId": new_chat_id })),
        Err(err) => {
            let status = StatusCode::from_u16(err.status_code())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            tracing::warn!(chat_id = %id, %err, "fork-worktree failed");
            fail(status, err.to_string())
        }
    }
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
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    // `AttachWorktreeBody`: worktreePath.min(1) then branchName.min(1) — first
    // failing issue wins.
    let b = parse_body::<AttachBody>(&body).unwrap_or(AttachBody {
        worktree_path: None,
        branch_name: None,
    });
    let Some(worktree_path) = b.worktree_path.filter(|s| !s.is_empty()) else {
        return fail(StatusCode::BAD_REQUEST, "Worktree path is required");
    };
    let Some(branch_name) = b.branch_name.filter(|s| !s.is_empty()) else {
        return fail(StatusCode::BAD_REQUEST, "Branch name is required");
    };
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "attach-worktree needs ChatManager (unwired)");
        return fail(StatusCode::BAD_REQUEST, "Failed to attach worktree");
    };
    match cm.attach_worktree(&id, &worktree_path, &branch_name).await {
        Ok(()) => ok_empty(),
        Err(err) => {
            tracing::warn!(chat_id = %id, %err, "attach-worktree failed");
            fail(StatusCode::BAD_REQUEST, err.to_string())
        }
    }
}

#[derive(Deserialize)]
struct DeleteWorktreeBody {
    #[serde(rename = "worktreePath")]
    worktree_path: Option<String>,
    #[serde(rename = "branchName")]
    branch_name: Option<String>,
}

async fn delete_worktree(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let project_path = match project_path(&ctx, &id).await {
        Ok(Some(path)) => path,
        Ok(None) => return fail(StatusCode::NOT_FOUND, "Project not found"),
        Err(resp) => return resp,
    };
    let parsed = parse_body::<DeleteWorktreeBody>(&body).unwrap_or(DeleteWorktreeBody {
        worktree_path: None,
        branch_name: None,
    });
    let Some(worktree_path) = parsed.worktree_path.filter(|s| !s.is_empty()) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid input");
    };

    match validate_and_delete_worktree(&ctx, &id, &project_path, &worktree_path, parsed.branch_name)
        .await
    {
        Ok(()) => ok_empty(),
        Err(message) => {
            tracing::warn!(project_id = %id, worktree_path = %worktree_path, %message, "delete-worktree failed");
            fail(StatusCode::BAD_REQUEST, message)
        }
    }
}

/// Port of `validateAndDeleteWorktree`: canonicalize + registry-validate the
/// worktree, kill each affected chat's background tasks, remove the worktree, then
/// re-broadcast `chat.updated` for chats that pointed at it. `Err` carries the exact
/// TS `throw new Error(...)` message the route surfaces as a 400.
async fn validate_and_delete_worktree(
    ctx: &Arc<AppCtx>,
    project_id: &str,
    project_path: &str,
    worktree_path: &str,
    branch_name: Option<String>,
) -> Result<(), String> {
    let real_project_path = tokio::fs::canonicalize(project_path)
        .await
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| project_path.to_string());
    let real_worktree_path = tokio::fs::canonicalize(worktree_path)
        .await
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|_| "Worktree path does not exist".to_string())?;
    if real_worktree_path == real_project_path {
        return Err("Cannot delete the main worktree".to_string());
    }

    let worktrees = get_worktrees(project_path).await;
    let matched = worktrees
        .into_iter()
        .find(|wt| wt.path == real_worktree_path || wt.path == worktree_path);
    let Some(matched) = matched else {
        return Err("Worktree path is not a registered worktree of this project".to_string());
    };
    let resolved_branch = branch_name.or_else(|| {
        matched
            .branch
            .as_ref()
            .map(|b| b.replace("refs/heads/", ""))
    });
    let Some(resolved_branch) = resolved_branch else {
        return Err("Cannot determine branch name for worktree".to_string());
    };

    // Kill background tasks for every chat whose worktree resolves to this one.
    let pid = project_id.to_string();
    let chats = ctx
        .db
        .call(move |db| db.chats.list(&pid))
        .await
        .unwrap_or_default();
    for chat in chats {
        let Some(chat_wt) = chat.worktree_path.clone() else {
            continue;
        };
        // Match by realpath equality, falling back to raw-string equality (so a
        // request path like '/wt/x/', a symlinked alias, or a worktree already gone
        // from disk still sweeps the chat's tracker entries).
        let canonical_match = matches!(
            tokio::fs::canonicalize(&chat_wt).await,
            Ok(real) if real.to_string_lossy() == real_worktree_path.as_str()
        );
        if !(canonical_match || chat_wt == worktree_path) {
            continue;
        }
        let session = ctx
            .chat_manager
            .as_ref()
            .and_then(|cm| cm.get_session_for_chat(&chat.id))
            .map(SessionKillBridge);
        let session_ref = session.as_ref().map(|s| s as &dyn SessionLike);
        kill_tasks_for_chat(KillTasksForChatArgs {
            chat_id: &chat.id,
            // canonical path so the sweep targets the right spool prefix.
            worktree_path: Some(&real_worktree_path),
            session: session_ref,
            tracker: &ctx.background_tasks,
            spool_root: None,
        })
        .await;
    }

    remove_worktree(project_path, worktree_path, &resolved_branch).await;
    if let Some(cm) = ctx.chat_manager.as_ref() {
        cm.notify_worktree_deleted(worktree_path);
    }
    Ok(())
}

/// Bridges the live `AdapterSession` to the `SessionLike` the kill sweep expects
/// (identical to `chat_deps::SessionKillAdapter`; a per-request local so the route
/// stays self-contained).
struct SessionKillBridge(Arc<dyn AdapterSession>);

impl SessionLike for SessionKillBridge {
    fn stop_background_task<'a>(&'a self, task_id: &'a str) -> BoxFuture<'a, StopResult> {
        let session = Arc::clone(&self.0);
        let task_id = task_id.to_string();
        Box::pin(async move {
            match session.stop_background_task(task_id).await {
                Ok(r) => StopResult {
                    ok: r.ok,
                    error: r.error,
                },
                Err(err) => StopResult {
                    ok: false,
                    error: Some(err.to_string()),
                },
            }
        })
    }
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
// todos: 0
// notes: GET /api/projects/:id/git/worktrees ports fully over db.projects +
// mainframe_services::workspace::get_worktrees (filtering the main worktree).
// enable/disable/attach/fork call the real ChatManager facade (config manager +
// lifecycle+config for fork; fork maps DirtyWorkingTree → 409 via ForkError::status_code).
// delete-worktree ports `validateAndDeleteWorktree` whole: canonicalize + registry
// validation, per-affected-chat killTasksForChat (SessionKillBridge → SessionLike),
// removeWorktree, then cm.notifyWorktreeDeleted. Unwired (Phase-3 harness) → the TS
// failure-path envelope after input validation.
