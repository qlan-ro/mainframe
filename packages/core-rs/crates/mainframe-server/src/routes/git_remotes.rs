//! `GET /api/projects/:id/git/github-remotes`: the GitHub remotes offered to
//! the repo-link dialog.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use mainframe_git::git_parse::github_repo_from_url;
use serde::Serialize;
use serde_json::json;

use crate::async_err::internal_error;
use crate::ctx::AppCtx;
use crate::respond::ok;
use crate::routes::git::{ChatIdQuery, get_effective_path, is_not_git_repo_err};

/// A GitHub remote derived from `git remote -v`, offered to the repo-link
/// dialog. Only remotes whose URL yields a valid `owner/repo` are included —
/// other hosts and malformed paths are silently dropped.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitHubRemote {
    name: String,
    owner: String,
    repo: String,
}

/// `GET /api/projects/:id/git/github-remotes?chatId=`.
async fn github_remotes(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
) -> Response {
    let base_path = match get_effective_path(&ctx, &id, q.chat_id.as_deref()).await {
        Ok(Some(p)) => p,
        Ok(None) => return crate::respond::ApiError::project_not_found().into_response(),
        Err(e) => return internal_error("Failed to resolve project path", &e),
    };
    let raw_remotes = match ctx
        .core
        .git
        .for_project(base_path.clone())
        .remotes_with_urls()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            if !is_not_git_repo_err(&e) {
                tracing::warn!(error = %e, base_path, "Failed to list git remotes");
            }
            Vec::new()
        }
    };
    let remotes: Vec<GitHubRemote> = raw_remotes
        .into_iter()
        .filter_map(|r| {
            github_repo_from_url(&r.url).map(|repo| GitHubRemote {
                name: r.name,
                owner: repo.owner,
                repo: repo.repo,
            })
        })
        .collect();
    ok(json!({ "remotes": remotes }))
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/projects/{id}/git/github-remotes", get(github_remotes))
}

#[cfg(test)]
#[path = "git_remotes_tests.rs"]
mod tests;
