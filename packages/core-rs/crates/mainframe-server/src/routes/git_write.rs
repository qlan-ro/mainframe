//! Ported from `src/server/routes/git-write.ts` — the 13 git write/read-write
//! endpoints (branches, checkout, commit, branch, fetch, pull, push, merge,
//! rebase, abort, rename-branch, delete-branch, update-all).
//!
//! Every mutation goes through `GitService` (which owns the per-project write
//! lock). The TS `gitRoute` combinator resolves the project FIRST (404), then
//! validates the body (400), then runs the op (500 on failure, leaking the git
//! error message). This port preserves that order and the leaked-message 500.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::async_err::internal_error;
use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};

use super::git::{ChatIdQuery, get_effective_path, git_error_message, parse_json_body};

// ── body schemas (schemas.ts git-write group; land with this route agent) ─────

#[derive(Debug, Deserialize)]
struct CheckoutBody {
    branch: String,
}
#[derive(Debug, Deserialize)]
struct CommitBody {
    message: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBranchBody {
    name: String,
    start_point: Option<String>,
}
#[derive(Debug, Deserialize)]
struct FetchBody {
    remote: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullBody {
    remote: Option<String>,
    branch: Option<String>,
    local_branch: Option<String>,
}
#[derive(Debug, Deserialize)]
struct PushBody {
    branch: Option<String>,
    remote: Option<String>,
}
#[derive(Debug, Deserialize)]
struct BranchArgBody {
    branch: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameBranchBody {
    old_name: String,
    new_name: String,
}
#[derive(Debug, Deserialize)]
struct DeleteBranchBody {
    name: String,
    force: Option<bool>,
    remote: Option<bool>,
}

/// `gitBranchName` — `^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$` (schemas.ts).
fn is_valid_branch_name(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphanumeric() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '.' | '-'))
}

// ── shared resolution (resolveProject + body Value) ──────────────────────────

/// `resolveProject(ctx, req)` — chatId from `?chatId` OR the request body, then
/// `getEffectivePath`. Returns the project path plus the parsed body `Value`
/// (parsed once so the body `chatId` is available before schema validation).
async fn resolve(
    ctx: &AppCtx,
    project_id: &str,
    query_chat_id: Option<&str>,
    bytes: &[u8],
) -> Result<(String, Value), Response> {
    let body: Value = serde_json::from_slice(bytes).unwrap_or(Value::Null);
    let chat_id = query_chat_id.map(str::to_string).or_else(|| {
        body.get("chatId")
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    match get_effective_path(ctx, project_id, chat_id.as_deref()).await {
        Ok(Some(path)) => Ok((path, body)),
        Ok(None) => Err(fail(StatusCode::NOT_FOUND, "Project not found")),
        Err(e) => Err(internal_error("Failed to resolve project path", &e)),
    }
}

/// Deserialize the already-parsed body `Value` into a schema `T` (the
/// `schema.safeParse(req.body)` step). `Err` carries the validation message the
/// caller turns into a 400.
fn body_of<T: DeserializeOwned>(body: Value) -> Result<T, String> {
    parse_json_body::<T>(body.to_string().as_bytes())
}

/// Map a git op `Result` to the write envelope: `Ok` → 200, `Err` → 500 with the
/// leaked git error message (the TS `fail(res, 500, err.message)`).
fn git_result<T: serde::Serialize>(
    result: Result<T, mainframe_git::git_service::GitServiceError>,
    label: &str,
) -> Response {
    match result {
        Ok(v) => ok(v),
        Err(e) => {
            tracing::warn!(error = %e, "{label} failed");
            fail(StatusCode::INTERNAL_SERVER_ERROR, git_error_message(&e))
        }
    }
}

/// Like [`git_result`] but for `Result<(), _>` ops → `okEmpty` on success.
fn git_empty(
    result: Result<(), mainframe_git::git_service::GitServiceError>,
    label: &str,
) -> Response {
    match result {
        Ok(()) => ok_empty(),
        Err(e) => {
            tracing::warn!(error = %e, "{label} failed");
            fail(StatusCode::INTERNAL_SERVER_ERROR, git_error_message(&e))
        }
    }
}

// ── handlers ─────────────────────────────────────────────────────────────────

async fn branches(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
) -> Response {
    let base_path = match get_effective_path(&ctx, &id, q.chat_id.as_deref()).await {
        Ok(Some(p)) => p,
        Ok(None) => return fail(StatusCode::NOT_FOUND, "Project not found"),
        Err(e) => return internal_error("Failed to resolve project path", &e),
    };
    git_result(ctx.git.for_project(base_path).branches().await, "branches")
}

async fn checkout(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
    body: Bytes,
) -> Response {
    let (path, val) = match resolve(&ctx, &id, q.chat_id.as_deref(), &body).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let data: CheckoutBody = match body_of(val) {
        Ok(d) => d,
        Err(m) => return fail(StatusCode::BAD_REQUEST, m),
    };
    if data.branch.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "branch must not be empty");
    }
    git_empty(
        ctx.git.for_project(path).checkout(&data.branch).await,
        "checkout",
    )
}

async fn commit(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
    body: Bytes,
) -> Response {
    let (path, val) = match resolve(&ctx, &id, q.chat_id.as_deref(), &body).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let data: CommitBody = match body_of(val) {
        Ok(d) => d,
        Err(m) => return fail(StatusCode::BAD_REQUEST, m),
    };
    if data.message.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "Commit message cannot be empty");
    }
    match ctx.git.for_project(path).commit_all(&data.message).await {
        Ok(commit) => ok(json!({ "commit": commit })),
        Err(e) => {
            tracing::warn!(error = %e, "commit failed");
            fail(StatusCode::INTERNAL_SERVER_ERROR, git_error_message(&e))
        }
    }
}

async fn create_branch(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
    body: Bytes,
) -> Response {
    let (path, val) = match resolve(&ctx, &id, q.chat_id.as_deref(), &body).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let data: CreateBranchBody = match body_of(val) {
        Ok(d) => d,
        Err(m) => return fail(StatusCode::BAD_REQUEST, m),
    };
    if !is_valid_branch_name(&data.name) {
        return fail(StatusCode::BAD_REQUEST, "Invalid branch name");
    }
    git_empty(
        ctx.git
            .for_project(path)
            .create_branch(&data.name, data.start_point.as_deref())
            .await,
        "createBranch",
    )
}

async fn fetch(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
    body: Bytes,
) -> Response {
    let (path, val) = match resolve(&ctx, &id, q.chat_id.as_deref(), &body).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let data: FetchBody = match body_of(val) {
        Ok(d) => d,
        Err(m) => return fail(StatusCode::BAD_REQUEST, m),
    };
    git_result(
        ctx.git
            .for_project(path)
            .fetch(data.remote.as_deref())
            .await,
        "fetch",
    )
}

async fn pull(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
    body: Bytes,
) -> Response {
    let (path, val) = match resolve(&ctx, &id, q.chat_id.as_deref(), &body).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let data: PullBody = match body_of(val) {
        Ok(d) => d,
        Err(m) => return fail(StatusCode::BAD_REQUEST, m),
    };
    let lb = data.local_branch.as_deref().is_some_and(|s| !s.is_empty());
    let b = data.branch.as_deref().is_some_and(|s| !s.is_empty());
    if lb && !b {
        return fail(
            StatusCode::BAD_REQUEST,
            "branch is required when localBranch is set",
        );
    }
    git_result(
        ctx.git
            .for_project(path)
            .pull(
                data.remote.as_deref(),
                data.branch.as_deref(),
                data.local_branch.as_deref(),
            )
            .await,
        "pull",
    )
}

async fn push(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
    body: Bytes,
) -> Response {
    let (path, val) = match resolve(&ctx, &id, q.chat_id.as_deref(), &body).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let data: PushBody = match body_of(val) {
        Ok(d) => d,
        Err(m) => return fail(StatusCode::BAD_REQUEST, m),
    };
    git_result(
        ctx.git
            .for_project(path)
            .push(data.branch.as_deref(), data.remote.as_deref())
            .await,
        "push",
    )
}

async fn merge(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
    body: Bytes,
) -> Response {
    let (path, val) = match resolve(&ctx, &id, q.chat_id.as_deref(), &body).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let data: BranchArgBody = match body_of(val) {
        Ok(d) => d,
        Err(m) => return fail(StatusCode::BAD_REQUEST, m),
    };
    if data.branch.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "branch must not be empty");
    }
    git_result(ctx.git.for_project(path).merge(&data.branch).await, "merge")
}

async fn rebase(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
    body: Bytes,
) -> Response {
    let (path, val) = match resolve(&ctx, &id, q.chat_id.as_deref(), &body).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let data: BranchArgBody = match body_of(val) {
        Ok(d) => d,
        Err(m) => return fail(StatusCode::BAD_REQUEST, m),
    };
    if data.branch.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "branch must not be empty");
    }
    git_result(
        ctx.git.for_project(path).rebase(&data.branch).await,
        "rebase",
    )
}

async fn abort(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
    body: Bytes,
) -> Response {
    let (path, _val) = match resolve(&ctx, &id, q.chat_id.as_deref(), &body).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    git_result(ctx.git.for_project(path).abort().await, "abort")
}

async fn rename_branch(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
    body: Bytes,
) -> Response {
    let (path, val) = match resolve(&ctx, &id, q.chat_id.as_deref(), &body).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let data: RenameBranchBody = match body_of(val) {
        Ok(d) => d,
        Err(m) => return fail(StatusCode::BAD_REQUEST, m),
    };
    if data.old_name.is_empty() || !is_valid_branch_name(&data.new_name) {
        return fail(StatusCode::BAD_REQUEST, "Invalid branch name");
    }
    git_empty(
        ctx.git
            .for_project(path)
            .rename_branch(&data.old_name, &data.new_name)
            .await,
        "renameBranch",
    )
}

async fn delete_branch(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
    body: Bytes,
) -> Response {
    let (path, val) = match resolve(&ctx, &id, q.chat_id.as_deref(), &body).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let data: DeleteBranchBody = match body_of(val) {
        Ok(d) => d,
        Err(m) => return fail(StatusCode::BAD_REQUEST, m),
    };
    if data.name.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "name must not be empty");
    }
    git_result(
        ctx.git
            .for_project(path)
            .delete_branch(
                &data.name,
                data.force.unwrap_or(false),
                data.remote.unwrap_or(false),
            )
            .await,
        "deleteBranch",
    )
}

async fn update_all(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
    body: Bytes,
) -> Response {
    let (path, _val) = match resolve(&ctx, &id, q.chat_id.as_deref(), &body).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    git_result(ctx.git.for_project(path).update_all().await, "updateAll")
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/projects/{id}/git/branches", get(branches))
        .route("/api/projects/{id}/git/checkout", post(checkout))
        .route("/api/projects/{id}/git/commit", post(commit))
        .route("/api/projects/{id}/git/branch", post(create_branch))
        .route("/api/projects/{id}/git/fetch", post(fetch))
        .route("/api/projects/{id}/git/pull", post(pull))
        .route("/api/projects/{id}/git/push", post(push))
        .route("/api/projects/{id}/git/merge", post(merge))
        .route("/api/projects/{id}/git/rebase", post(rebase))
        .route("/api/projects/{id}/git/abort", post(abort))
        .route("/api/projects/{id}/git/rename-branch", post(rename_branch))
        .route("/api/projects/{id}/git/delete-branch", post(delete_branch))
        .route("/api/projects/{id}/git/update-all", post(update_all))
}

// PORT STATUS: src/server/routes/git-write.ts (13 endpoints)
// confidence: high
// todos: 0
// notes: Order preserved (resolveProject 404 → body 400 → git op). Errors leak
// the git message via fail(500, message) (NOT the opaque async_err handler) —
// git-review.test.ts asserts the leaked "Nothing to commit". chatId is read from
// `?chatId` OR the body (parsed once into a Value). Zod refinements ported
// explicitly: gitBranchName regex (create/rename newName), min(1) on
// branch/message/name; GitPullBody's localBranch-requires-branch refine.
// `branch` (POST create) and `branch` (GET current) share the `/git/branch`
// path by method, matching the Express router.
