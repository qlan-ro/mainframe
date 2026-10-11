use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::Deserialize;

use mainframe_background_tasks::kill::{KillTasksForChatArgs, SessionLike, kill_tasks_for_chat};
use mainframe_services::workspace::{get_worktrees, remove_worktree, short_branch};

use crate::ctx::AppCtx;
use crate::input_error::InputError;
use crate::orchestration_deps::branch_name_ok;
use crate::respond::{fail, ok, ok_empty};
use crate::routes::body::parse_body;

async fn project_path(
    ctx: &Arc<AppCtx>,
    project_id: &str,
) -> Result<Option<String>, crate::respond::ApiError> {
    let pid = project_id.to_string();
    match ctx.core.db.call(move |db| db.projects.get(&pid)).await {
        Ok(project) => Ok(project.map(|p| p.path)),
        Err(err) => Err(crate::respond::ApiError::internal("get project", &err)),
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
// pair. The first failing check wins.
fn validate_enable_fork(body: &Bytes) -> Result<(String, String), crate::respond::ApiError> {
    let Some(b) = parse_body::<WorktreeBody>(body) else {
        return Err(crate::respond::ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid input",
        ));
    };
    let Some(base) = b.base_branch.filter(|s| !s.is_empty()) else {
        return Err(crate::respond::ApiError::new(
            StatusCode::BAD_REQUEST,
            "Base branch is required",
        ));
    };
    match b.branch_name.as_deref() {
        Some(name) if branch_name_ok(name) => Ok((base, name.to_string())),
        Some("") | None => Err(crate::respond::ApiError::new(
            StatusCode::BAD_REQUEST,
            "Branch name is required",
        )),
        _ => Err(crate::respond::ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid branch name",
        )),
    }
}

async fn enable_worktree(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let (base, branch) = match validate_enable_fork(&body) {
        Ok(v) => v,
        Err(resp) => return resp.into_response(),
    };
    let cm = &ctx.chat.chat_manager;
    match cm.enable_worktree(&id, &base, &branch).await {
        Ok(()) => ok_empty(),
        Err(err) => crate::respond::fail_domain(format!("enable-worktree failed id={id}"), &err),
    }
}

async fn disable_worktree(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let cm = &ctx.chat.chat_manager;
    match cm.disable_worktree(&id).await {
        Ok(()) => ok_empty(),
        Err(err) => crate::respond::fail_domain(format!("disable-worktree failed id={id}"), &err),
    }
}

async fn fork_worktree(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let (base, branch) = match validate_enable_fork(&body) {
        Ok(v) => v,
        Err(resp) => return resp.into_response(),
    };
    let cm = &ctx.chat.chat_manager;
    match cm.fork_to_worktree(&id, &base, &branch).await {
        Ok(new_chat_id) => ok(serde_json::json!({ "chatId": new_chat_id })),
        Err(err) => crate::respond::fail_domain(format!("fork-worktree failed id={id}"), &err),
    }
}

async fn list_worktrees(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let path = match project_path(&ctx, &id).await {
        Ok(Some(path)) => path,
        Ok(None) => return crate::respond::ApiError::project_not_found().into_response(),
        Err(resp) => return resp.into_response(),
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
    // Attach body: non-empty worktreePath, then non-empty branchName — the first
    // failing check wins.
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
    let cm = &ctx.chat.chat_manager;
    match cm
        .attach_worktree(&id, &worktree_path, Some(&branch_name))
        .await
    {
        Ok(()) => ok_empty(),
        Err(err) => crate::respond::fail_domain(format!("attach-worktree failed id={id}"), &err),
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
        Ok(None) => return crate::respond::ApiError::project_not_found().into_response(),
        Err(resp) => return resp.into_response(),
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
        Err(err) => err.into_response(),
    }
}

/// Canonicalize + registry-validate the worktree, kill each affected chat's
/// background tasks, remove the worktree, then re-broadcast `chat.updated` for
/// chats that pointed at it. `Err` carries the message the route surfaces as a
/// 400.
async fn validate_and_delete_worktree(
    ctx: &Arc<AppCtx>,
    project_id: &str,
    project_path: &str,
    worktree_path: &str,
    branch_name: Option<String>,
) -> Result<(), crate::respond::ApiError> {
    let real_project_path = tokio::fs::canonicalize(project_path)
        .await
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| project_path.to_string());
    let real_worktree_path = tokio::fs::canonicalize(worktree_path)
        .await
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|_| InputError::Rejected("Worktree path does not exist"))?;
    if real_worktree_path == real_project_path {
        return Err(InputError::Rejected("Cannot delete the main worktree").into());
    }

    let worktrees = get_worktrees(project_path).await;
    let matched = worktrees
        .into_iter()
        .find(|wt| wt.path == real_worktree_path || wt.path == worktree_path);
    let Some(matched) = matched else {
        return Err(InputError::Rejected(
            "Worktree path is not a registered worktree of this project",
        )
        .into());
    };
    let resolved_branch =
        branch_name.or_else(|| matched.branch.as_ref().map(|b| short_branch(b).to_string()));
    let Some(resolved_branch) = resolved_branch else {
        return Err(InputError::Rejected("Cannot determine branch name for worktree").into());
    };

    kill_worktree_tasks(ctx, project_id, worktree_path, &real_worktree_path).await?;

    let cm = &ctx.chat.chat_manager;
    let affected = cm
        .stop_worktree_services_with_aliases(
            project_id,
            &real_worktree_path,
            &[worktree_path, &matched.path],
        )
        .await?;
    remove_worktree(project_path, &real_worktree_path, &resolved_branch).await;
    for chat_id in affected {
        cm.emit_chat_updated(&chat_id);
    }
    Ok(())
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
#[path = "worktree_tests.rs"]
mod tests;

async fn kill_worktree_tasks(
    ctx: &Arc<AppCtx>,
    project_id: &str,
    worktree_path: &str,
    real_worktree_path: &str,
) -> Result<(), crate::respond::ApiError> {
    // Kill background tasks for every chat whose worktree resolves to this one.
    let pid = project_id.to_string();
    let chats = ctx.core.db.call(move |db| db.chats.list(&pid)).await?;
    for chat in chats {
        let Some(chat_wt) = chat.worktree_path.clone() else {
            continue;
        };
        // Match by realpath equality, falling back to raw-string equality (so a
        // request path like '/wt/x/', a symlinked alias, or a worktree already gone
        // from disk still sweeps the chat's tracker entries).
        let canonical_match = matches!(
            tokio::fs::canonicalize(&chat_wt).await,
            Ok(real) if real.to_string_lossy() == real_worktree_path
        );
        if !(canonical_match || chat_wt == worktree_path) {
            continue;
        }
        let session = ctx
            .chat
            .chat_manager
            .get_session_for_chat(&chat.id)
            .map(crate::session_kill_bridge::SessionKillBridge);
        let session_ref = session.as_ref().map(|s| s as &dyn SessionLike);
        kill_tasks_for_chat(KillTasksForChatArgs {
            chat_id: &chat.id,
            // canonical path so the sweep targets the right spool prefix.
            worktree_path: Some(real_worktree_path),
            session: session_ref,
            tracker: &ctx.core.background_tasks,
            spool_root: None,
        })
        .await;
    }

    Ok(())
}
