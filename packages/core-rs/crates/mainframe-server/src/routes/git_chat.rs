//! Ported from `src/server/routes/git-chat.ts` — the 6 chat-scoped git endpoints
//! (status/stage/unstage/commit/push over `/api/git/*`, plus
//! `/api/projects/:id/git/diff-since-main`).
//!
//! These resolve the working directory through the chat (worktree or project
//! root). Phase 3 has no `ChatManager`, so resolution goes through the shared
//! `git::resolve_chat_path` / `git::get_effective_path` helpers (db repos +
//! `workspace::is_worktree_present`). `chatRoute` failures map to 400 with the
//! leaked git error message (NOT the opaque async_err handler).

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;
use mainframe_git::GitService;
use mainframe_git::git_parse::{parse_diff_name_status, parse_status_buckets};
use mainframe_git::git_service::GitServiceError;
use mainframe_types::git::PushResult;
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::async_err::internal_error;
use crate::ctx::AppCtx;
use crate::path_utils::resolve_and_validate_path;
use crate::respond::{fail, ok, ok_empty};

use super::git::{
    chat_worktree_missing, get_effective_path, git_error_message, is_not_git_repo_err,
    parse_json_body, resolve_chat_path,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusBody {
    chat_id: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StageBody {
    chat_id: String,
    files: Vec<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitBody {
    chat_id: String,
    message: String,
    files: Vec<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiffSinceMainBody {
    chat_id: Option<String>,
    files: Option<Vec<String>>,
}

/// Resolve the chat's working dir + `GitService`, applying the worktree-missing
/// (409) / not-found (404) guard and, when asked, path-validating each file
/// (400). Returns an error `Response` on any guard failure.
async fn resolve_chat_ctx(
    ctx: &AppCtx,
    chat_id: &str,
    files: Option<&[String]>,
    validate_paths: bool,
) -> Result<(GitService, String), Response> {
    let work_dir = match resolve_chat_path(ctx, chat_id).await {
        Ok(Some(w)) => w,
        Ok(None) => {
            return Err(match chat_worktree_missing(ctx, chat_id).await {
                Ok(true) => fail(StatusCode::CONFLICT, "Worktree missing"),
                Ok(false) => fail(StatusCode::NOT_FOUND, "Chat not found"),
                Err(e) => internal_error("Failed to resolve chat path", &e),
            });
        }
        Err(e) => return Err(internal_error("Failed to resolve chat path", &e)),
    };
    if validate_paths && let Some(files) = files {
        for file in files {
            if resolve_and_validate_path(&work_dir, file).await.is_none() {
                return Err(fail(
                    StatusCode::BAD_REQUEST,
                    format!("Path outside project: {file}"),
                ));
            }
        }
    }
    Ok((ctx.git.for_project(work_dir.clone()), work_dir))
}

/// `chatRoute`'s catch arm: `if (!isNotGitRepo) log`; `fail(400, message)`.
fn chat_git_fail(err: &GitServiceError, label: &str) -> Response {
    if !is_not_git_repo_err(err) {
        tracing::error!(error = %err, "{label} failed");
    }
    fail(StatusCode::BAD_REQUEST, git_error_message(err))
}

// ── handlers ─────────────────────────────────────────────────────────────────

async fn status(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let data: StatusBody = match parse_json_body(&body) {
        Ok(d) => d,
        Err(m) => return fail(StatusCode::BAD_REQUEST, m),
    };
    let (svc, _) = match resolve_chat_ctx(&ctx, &data.chat_id, None, false).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    match svc.status_raw().await {
        Ok(raw) => ok(parse_status_buckets(&raw)),
        Err(e) => chat_git_fail(&e, "status"),
    }
}

async fn stage(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    stage_impl(ctx, body, false).await
}

async fn unstage(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    stage_impl(ctx, body, true).await
}

async fn stage_impl(ctx: Arc<AppCtx>, body: Bytes, unstage: bool) -> Response {
    let data: StageBody = match parse_json_body(&body) {
        Ok(d) => d,
        Err(m) => return fail(StatusCode::BAD_REQUEST, m),
    };
    let (svc, _) = match resolve_chat_ctx(&ctx, &data.chat_id, Some(&data.files), true).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if data.files.is_empty() {
        return ok_empty();
    }
    let result = if unstage {
        svc.unstage(&data.files).await
    } else {
        svc.stage(&data.files).await
    };
    match result {
        Ok(()) => ok_empty(),
        Err(e) => chat_git_fail(&e, if unstage { "unstage" } else { "stage" }),
    }
}

async fn commit(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let data: CommitBody = match parse_json_body(&body) {
        Ok(d) => d,
        Err(m) => return fail(StatusCode::BAD_REQUEST, m),
    };
    if data.message.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "Commit message cannot be empty");
    }
    let (svc, _) = match resolve_chat_ctx(&ctx, &data.chat_id, Some(&data.files), true).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let outcome = async {
        if !data.files.is_empty() {
            svc.stage(&data.files).await?;
        }
        svc.commit(&data.message).await
    }
    .await;
    match outcome {
        Ok(hash) => ok(json!({ "hash": hash })),
        Err(e) => chat_git_fail(&e, "commit"),
    }
}

async fn push(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let data: StatusBody = match parse_json_body(&body) {
        Ok(d) => d,
        Err(m) => return fail(StatusCode::BAD_REQUEST, m),
    };
    let (svc, _) = match resolve_chat_ctx(&ctx, &data.chat_id, None, false).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    match svc.push(None, None).await {
        Ok(PushResult::Rejected { message }) => fail(StatusCode::BAD_REQUEST, message),
        Ok(_) => ok_empty(),
        Err(e) => chat_git_fail(&e, "push"),
    }
}

/// `POST /api/projects/:id/git/diff-since-main`.
async fn diff_since_main(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let data: DiffSinceMainBody = match parse_json_body(&body) {
        Ok(d) => d,
        Err(m) => return fail(StatusCode::BAD_REQUEST, m),
    };
    let base_path = match get_effective_path(&ctx, &id, data.chat_id.as_deref()).await {
        Ok(Some(p)) => p,
        Ok(None) => return diff_since_main_not_found(&ctx, data.chat_id.as_deref()).await,
        Err(e) => return internal_error("Failed to resolve project path", &e),
    };
    match compute_diff_since_main(&ctx, &base_path, data.files.as_deref()).await {
        Ok(v) => ok(v),
        Err(e) => {
            tracing::error!(error = %e, base_path, "Failed to get diff since main");
            fail(StatusCode::BAD_REQUEST, git_error_message(&e))
        }
    }
}

/// The null-base branch of diff-since-main: 409 when the chat's worktree is
/// missing, else 404 "Project not found".
async fn diff_since_main_not_found(ctx: &AppCtx, chat_id: Option<&str>) -> Response {
    if let Some(chat_id) = chat_id {
        match chat_worktree_missing(ctx, chat_id).await {
            Ok(true) => return fail(StatusCode::CONFLICT, "Worktree missing"),
            Ok(false) => {}
            Err(e) => return internal_error("Failed to resolve project path", &e),
        }
    }
    fail(StatusCode::NOT_FOUND, "Project not found")
}

async fn compute_diff_since_main(
    ctx: &AppCtx,
    base_path: &str,
    files: Option<&[String]>,
) -> Result<Value, GitServiceError> {
    let svc = ctx.git.for_project(base_path.to_string());
    let Some(bi) = svc.detect_base_branch().await? else {
        return Ok(json!({ "diffs": {}, "baseBranch": null, "mergeBase": null }));
    };

    let mut name_status_args = vec!["--name-status".to_string(), bi.merge_base.clone()];
    if let Some(files) = files {
        name_status_args.push("--".to_string());
        name_status_args.extend(files.iter().cloned());
    }
    let changed = parse_diff_name_status(&svc.diff(&name_status_args).await?);

    let mut diffs = Map::new();
    for entry in changed {
        let mut main = String::new();
        if !entry.status.starts_with('A') {
            let key = entry.old_path.clone().unwrap_or_else(|| entry.path.clone());
            if let Ok(m) = svc.show(&format!("{}:{}", bi.merge_base, key)).await {
                main = m;
            }
        }
        let mut worktree = String::new();
        if !entry.status.starts_with('D')
            && let Some(resolved) = resolve_and_validate_path(base_path, &entry.path).await
            && let Ok(w) = tokio::fs::read_to_string(&resolved).await
        {
            worktree = w;
        }
        diffs.insert(entry.path, json!({ "main": main, "worktree": worktree }));
    }
    Ok(json!({ "diffs": diffs, "baseBranch": bi.base_branch, "mergeBase": bi.merge_base }))
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/git/status", post(status))
        .route("/api/git/stage", post(stage))
        .route("/api/git/unstage", post(unstage))
        .route("/api/git/commit", post(commit))
        .route("/api/git/push", post(push))
        .route(
            "/api/projects/{id}/git/diff-since-main",
            post(diff_since_main),
        )
}

// PORT STATUS: src/server/routes/git-chat.ts (6 endpoints)
// confidence: high
// todos: 0
// notes: chatRoute failures → 400 with the leaked git message; worktree-missing
// → 409, unknown chat → 404 "Chat not found". Empty `files` short-circuits to
// okEmpty (no git call). commit stages then commits; push maps Rejected → 400.
// diff-since-main uses the project-scoped resolver (409 vs 404 "Project not
// found"). Chat/project resolution runs through the shared git.rs helpers (the
// Phase-4 ChatManager seam) — no ChatManager dependency.
