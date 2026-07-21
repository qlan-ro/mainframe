//! Ported from `src/server/routes/suggestions.ts` — one endpoint: repo-derived
//! starting-point suggestions (churn + TODO/FIXME scan) for the new-session
//! Welcome state.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path as AxPath, State};
use axum::response::Response;
use axum::routing::get;
use mainframe_git::{GitService, parse_diff_name_status, parse_status_lines};
use mainframe_types::suggestion::Suggestion;

use crate::ctx::AppCtx;
use crate::path_utils::is_within_base;
use crate::respond::ok;
use crate::ripgrep::{RipgrepOptions, search_with_ripgrep};
use crate::routes::files::resolve_base;
use crate::suggestions::{
    ChurnInput, build_churn_suggestions, build_todo_suggestions, merge_suggestions,
};

use super::git::is_not_git_repo_err;

const TODO_MAX_RESULTS: usize = 200;

/// Gather churn counts via `GitService`. Returns nulls/zeros for a non-git dir.
async fn gather_churn(base_path: &str) -> ChurnInput {
    match gather_churn_inner(base_path).await {
        Ok(input) => input,
        Err(err) => {
            if !is_not_git_repo_err(&err) {
                tracing::warn!(error = %err, base_path, "Failed to gather churn signals");
            }
            ChurnInput {
                branch: None,
                base_branch: None,
                working_file_count: 0,
                branch_diff_count: 0,
            }
        }
    }
}

async fn gather_churn_inner(base_path: &str) -> Result<ChurnInput, mainframe_git::GitServiceError> {
    let svc = GitService::for_project(base_path);
    let branch = svc.current_branch().await?;
    let status = svc.status_raw().await?;
    let working_file_count = parse_status_lines(&status).len() as i64;

    let base_info = svc.detect_base_branch().await?;
    let mut base_branch = None;
    let mut branch_diff_count = 0;
    if let Some(info) = base_info
        && branch != info.base_branch
    {
        let name_status = svc
            .diff(&[
                "--name-status".to_string(),
                format!("{}..HEAD", info.merge_base),
            ])
            .await?;
        branch_diff_count = parse_diff_name_status(&name_status).len() as i64;
        base_branch = Some(info.base_branch);
    }

    Ok(ChurnInput {
        branch: Some(branch),
        base_branch,
        working_file_count,
        branch_diff_count,
    })
}

/// Bounded TODO/FIXME scan, each hit re-contained under the canonical base.
async fn gather_todo_matches(base_path: &str) -> Vec<String> {
    let Ok(real_base) = tokio::fs::canonicalize(base_path).await else {
        // expected: base vanished
        return Vec::new();
    };

    let hits = search_with_ripgrep(
        &real_base.to_string_lossy(),
        "TODO|FIXME",
        &RipgrepOptions {
            max_results: Some(TODO_MAX_RESULTS),
            max_file_size: None,
            include_ignored: false,
        },
    )
    .await;

    let mut out = Vec::new();
    for hit in hits {
        let abs = real_base.join(&hit.file);
        if is_within_base(&real_base, &abs) {
            out.push(hit.file);
        }
    }
    out
}

async fn handle_suggestions(ctx: &AppCtx, id: &str) -> Response {
    let base_path = match resolve_base(ctx, id, None).await {
        Ok(b) => b,
        Err(resp) => return resp,
    };

    let churn_input = gather_churn(&base_path).await;
    // `gather_churn`'s branch is `None` only when `base_path` isn't a git repo
    // (or git failed) — skip the TODO scan too so a non-project directory never
    // gets ripgrepped for arbitrary matches.
    let todo_matches = match &churn_input.branch {
        Some(_) => gather_todo_matches(&base_path).await,
        None => Vec::new(),
    };

    let churn = build_churn_suggestions(&churn_input);
    let todos = build_todo_suggestions(&todo_matches);
    ok(merge_suggestions(churn, todos) as Vec<Suggestion>)
}

async fn get_suggestions(State(ctx): State<Arc<AppCtx>>, AxPath(id): AxPath<String>) -> Response {
    handle_suggestions(&ctx, &id).await
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/projects/{id}/suggestions", get(get_suggestions))
}

// PORT STATUS: src/server/routes/suggestions.ts (75 lines)
// confidence: high
// todos: 0
// notes: `gatherChurn`/`gatherTodoMatches`/`handleSuggestions` ported 1:1 over
// the existing `GitService`, `parse_status_lines`/`parse_diff_name_status`, and
// `search_with_ripgrep`. The outer TS try/catch around `handleSuggestions` (which
// falls back to `ok(res, [])` on an unexpected throw) has no Rust counterpart:
// every inner call already returns via its own fallback path (`gather_churn`
// swallows `GitServiceError`, `gather_todo_matches` swallows a vanished base and
// `search_with_ripgrep` swallows process errors), so there is no throwing path
// left to catch. `getEffectivePath(ctx, id)` (no `chatId`) → `resolve_base(ctx,
// id, None)`, which already emits the 404 envelope. `RouteContext`'s Express
// `router.get` → a single `get_suggestions` handler + `router()`.
