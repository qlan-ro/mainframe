//! The 5 git-read endpoints (status/working-stat/branch/branch-diffs/diff).
//!
//! Also the crate-local home of the effective-path resolution helpers that
//! `git_write` and `git_chat` share. They resolve paths from the `mainframe-db`
//! chats/projects repos plus `mainframe-services::workspace::is_worktree_present`,
//! not through the `ChatManager`.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use mainframe_db::DbError;
use mainframe_git::git_parse::{is_not_git_repo, parse_diff_name_status, parse_status_lines};
use mainframe_git::git_service::GitServiceError;
use serde::Deserialize;
use serde_json::json;

use crate::async_err::internal_error;
use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use mainframe_runtime::fs::resolve_and_validate_path;

/// `?chatId=` query param shared by the project-scoped git routes.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatIdQuery {
    pub(crate) chat_id: Option<String>,
}

/// `source` is validated (rejects a non-`git` value with 400) but never branched
/// on; the response hardcodes `source: "git"`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitDiffQuery {
    chat_id: Option<String>,
    file: Option<String>,
    old_path: Option<String>,
    source: Option<String>,
    base: Option<String>,
}

// ── shared helpers (crate-local; used by git_write + git_chat) ────────────────

/// Whether a `GitServiceError` means "not a git repository": only a wrapped
/// `exec_git` rejection whose message names "not a git repository" qualifies.
pub(crate) fn is_not_git_repo_err(err: &GitServiceError) -> bool {
    matches!(err, GitServiceError::Exec(e) if is_not_git_repo(e))
}

/// The git error string the git-write/git-chat routes leak in their non-opaque
/// failure envelopes.
pub(crate) fn git_error_message(err: &GitServiceError) -> String {
    err.to_string()
}

/// The project-scoped effective-path resolver.
/// `Ok(None)` covers project-not-found, the cross-project guard, and a deleted
/// worktree (callers disambiguate via [`chat_worktree_missing`]).
pub(crate) async fn get_effective_path(
    ctx: &AppCtx,
    project_id: &str,
    chat_id: Option<&str>,
) -> Result<Option<String>, DbError> {
    match ctx.resolve_scope(project_id, chat_id).await {
        Ok(scope) => Ok(Some(scope.path)),
        Err(mainframe_services::workspace::ScopeError::Database(error)) => Err(error),
        Err(_) => Ok(None),
    }
}

pub(crate) async fn resolve_chat_path(
    ctx: &AppCtx,
    chat_id: &str,
) -> Result<Option<String>, DbError> {
    let cid = chat_id.to_owned();
    let Some(chat) = ctx.core.db.call(move |db| db.chats.get(&cid)).await? else {
        return Ok(None);
    };
    get_effective_path(ctx, &chat.project_id, Some(chat_id)).await
}

pub(crate) async fn chat_worktree_missing(ctx: &AppCtx, chat_id: &str) -> Result<bool, DbError> {
    let cid = chat_id.to_owned();
    let Some(chat) = ctx.core.db.call(move |db| db.chats.get(&cid)).await? else {
        return Ok(false);
    };
    match ctx.resolve_scope(&chat.project_id, Some(chat_id)).await {
        Err(mainframe_services::workspace::ScopeError::Database(error)) => Err(error),
        Err(mainframe_services::workspace::ScopeError::WorktreeMissing) => Ok(true),
        _ => Ok(false),
    }
}

// ── handlers ─────────────────────────────────────────────────────────────────

/// `GET /api/projects/:id/git/status`.
async fn status(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
) -> Response {
    let base_path = match get_effective_path(&ctx, &id, q.chat_id.as_deref()).await {
        Ok(Some(p)) => p,
        Ok(None) => return crate::respond::ApiError::project_not_found().into_response(),
        Err(e) => return internal_error("Failed to resolve project path", &e),
    };
    match ctx
        .core
        .git
        .for_project(base_path.clone())
        .status_raw()
        .await
    {
        Ok(raw) => ok(json!({ "files": parse_status_lines(&raw) })),
        Err(e) => {
            if !is_not_git_repo_err(&e) {
                tracing::warn!(error = %e, base_path, "Failed to get git status");
            }
            ok(json!({ "files": [], "error": "Not a git repository" }))
        }
    }
}

/// `GET /api/projects/:id/git/working-stat`.
async fn working_stat(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
) -> Response {
    let base_path = match get_effective_path(&ctx, &id, q.chat_id.as_deref()).await {
        Ok(Some(p)) => p,
        Ok(None) => return crate::respond::ApiError::project_not_found().into_response(),
        Err(e) => return internal_error("Failed to resolve project path", &e),
    };
    match ctx
        .core
        .git
        .for_project(base_path.clone())
        .working_stat()
        .await
    {
        Ok(stat) => ok(stat),
        Err(e) => {
            tracing::warn!(error = %e, base_path, "Failed to compute working stat");
            fail(StatusCode::INTERNAL_SERVER_ERROR, git_error_message(&e))
        }
    }
}

/// `GET /api/projects/:id/git/branch`.
async fn branch(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
) -> Response {
    let base_path = match get_effective_path(&ctx, &id, q.chat_id.as_deref()).await {
        Ok(Some(p)) => p,
        Ok(None) => return crate::respond::ApiError::project_not_found().into_response(),
        Err(e) => return internal_error("Failed to resolve project path", &e),
    };
    match ctx
        .core
        .git
        .for_project(base_path.clone())
        .current_branch()
        .await
    {
        Ok(b) => ok(json!({ "branch": b })),
        Err(e) => {
            if !is_not_git_repo_err(&e) {
                tracing::warn!(error = %e, base_path, "Failed to get git branch");
            }
            ok(json!({ "branch": null }))
        }
    }
}

/// `GET /api/projects/:id/git/branch-diffs`.
async fn branch_diffs(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
) -> Response {
    let base_path = match get_effective_path(&ctx, &id, q.chat_id.as_deref()).await {
        Ok(Some(p)) => p,
        Ok(None) => return crate::respond::ApiError::project_not_found().into_response(),
        Err(e) => return internal_error("Failed to resolve project path", &e),
    };
    let svc = ctx.core.git.for_project(base_path.clone());
    match compute_branch_diffs(&svc).await {
        Ok(v) => ok(v),
        Err(e) => {
            if !is_not_git_repo_err(&e) {
                tracing::warn!(error = %e, base_path, "Failed to compute branch diffs");
            }
            ok(json!({ "branch": null, "baseBranch": null, "mergeBase": null, "files": [] }))
        }
    }
}

async fn compute_branch_diffs(
    svc: &mainframe_git::GitService,
) -> Result<serde_json::Value, GitServiceError> {
    let branch = svc.current_branch().await?;
    let base_info = svc.detect_base_branch().await?;
    match base_info {
        Some(bi) if branch != bi.base_branch => {
            let out = svc
                .diff(&["--name-status".into(), format!("{}..HEAD", bi.merge_base)])
                .await?;
            Ok(json!({
                "branch": branch,
                "baseBranch": bi.base_branch,
                "mergeBase": bi.merge_base,
                "files": parse_diff_name_status(&out),
            }))
        }
        _ => Ok(json!({
            "branch": branch, "baseBranch": null, "mergeBase": null, "files": [],
        })),
    }
}

/// `GET /api/projects/:id/git/diff`.
async fn diff(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<GitDiffQuery>,
) -> Response {
    if let Some(source) = &q.source
        && source != "git"
    {
        return fail(StatusCode::BAD_REQUEST, "Invalid source");
    }
    let base_path = match get_effective_path(&ctx, &id, q.chat_id.as_deref()).await {
        Ok(Some(p)) => p,
        Ok(None) => return crate::respond::ApiError::project_not_found().into_response(),
        Err(e) => return internal_error("Failed to resolve project path", &e),
    };

    let svc = ctx.core.git.for_project(base_path.clone());
    let diff_args: Vec<String> = match (&q.file, &q.base) {
        (Some(f), Some(b)) => vec![format!("{b}..HEAD"), "--".into(), f.clone()],
        (Some(f), None) => vec!["--".into(), f.clone()],
        (None, Some(b)) => vec![format!("{b}..HEAD")],
        (None, None) => vec![],
    };
    let diff = match svc.diff(&diff_args).await {
        Ok(d) => d,
        Err(e) => {
            if !is_not_git_repo_err(&e) {
                tracing::warn!(error = %e, base_path, file = ?q.file, "Failed to compute git diff");
            }
            return ok(json!({ "diff": "", "original": "", "modified": "", "source": "git" }));
        }
    };

    let mut original = String::new();
    let mut modified = String::new();
    if let Some(file) = &q.file {
        let head_path = q.old_path.clone().unwrap_or_else(|| file.clone());
        let git_ref = q.base.clone().unwrap_or_else(|| "HEAD".into());
        if let Ok(o) = svc.show(&format!("{git_ref}:{head_path}")).await {
            original = o;
        }
        match resolve_and_validate_path(&base_path, file).await {
            None => return fail(StatusCode::FORBIDDEN, "Path outside project"),
            Some(resolved) => {
                if let Ok(m) = tokio::fs::read_to_string(&resolved).await {
                    modified = m;
                }
            }
        }
    }
    ok(json!({ "diff": diff, "original": original, "modified": modified, "source": "git" }))
}

/// The 5 git-read routes. `git_write` / `git_chat` are mounted separately in
/// `http.rs`.
pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/projects/{id}/git/branch-diffs", get(branch_diffs))
        .route("/api/projects/{id}/git/status", get(status))
        .route("/api/projects/{id}/git/working-stat", get(working_stat))
        .route("/api/projects/{id}/git/branch", get(branch))
        .route("/api/projects/{id}/git/diff", get(diff))
}
