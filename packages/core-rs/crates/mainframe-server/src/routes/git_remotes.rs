//! `GET /api/projects/:id/git/github-remotes` — task 24 of the GitHub Issues
//! sync plan (group `git-remotes`). Kept out of `git.rs` per the plan's
//! fallback instruction: that file is already at the 300-line file cap, so
//! this route and its tests live in their own module instead.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::get;
use mainframe_git::git_parse::github_repo_from_url;
use serde::Serialize;
use serde_json::json;

use crate::async_err::internal_error;
use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::git::{ChatIdQuery, get_effective_path, is_not_git_repo_err};

/// A GitHub remote derived from `git remote -v`, offered to the repo-link
/// dialog. Only remotes whose URL yields a valid `owner/repo` are included
/// (AC2) — other hosts and malformed paths are silently dropped.
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
        Ok(None) => return fail(StatusCode::NOT_FOUND, "Project not found"),
        Err(e) => return internal_error("Failed to resolve project path", &e),
    };
    let raw_remotes = match ctx
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
mod tests {
    use axum::body::to_bytes;
    use axum::extract::{Path, Query, State};
    use axum::http::StatusCode;
    use axum::response::Response;
    use tokio::process::Command;

    use super::super::git::ChatIdQuery;
    use super::super::git_remotes::github_remotes;
    use crate::ctx::AppCtx;

    async fn read(resp: Response) -> (StatusCode, serde_json::Value) {
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    async fn git(dir: &std::path::Path, args: &[&str]) {
        Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .await
            .unwrap();
    }

    async fn init_repo(dir: &std::path::Path) {
        git(dir, &["init"]).await;
        git(dir, &["config", "user.email", "test@test.com"]).await;
        git(dir, &["config", "user.name", "Test"]).await;
    }

    #[tokio::test]
    async fn returns_only_valid_github_remotes() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir).await;
        git(
            dir,
            &["remote", "add", "origin", "git@github.com:acme/widgets.git"],
        )
        .await;
        git(
            dir,
            &[
                "remote",
                "add",
                "upstream",
                "https://gitlab.com/acme/widgets.git",
            ],
        )
        .await;

        let ctx = AppCtx::test_ctx();
        let project = ctx
            .db
            .call({
                let path = dir.to_string_lossy().into_owned();
                move |db| db.projects.create(&path, Some("widgets"))
            })
            .await
            .unwrap();

        let (status, body) =
            read(github_remotes(State(ctx), Path(project.id), Query(ChatIdQuery::default())).await)
                .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["data"]["remotes"],
            serde_json::json!([{ "name": "origin", "owner": "acme", "repo": "widgets" }])
        );
    }

    #[tokio::test]
    async fn unknown_project_404s() {
        let ctx = AppCtx::test_ctx();
        let (status, body) = read(
            github_remotes(
                State(ctx),
                Path("nope".into()),
                Query(ChatIdQuery::default()),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "Project not found");
    }

    #[tokio::test]
    async fn repo_with_no_github_remote_returns_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir).await;
        git(
            dir,
            &[
                "remote",
                "add",
                "origin",
                "https://gitlab.com/acme/widgets.git",
            ],
        )
        .await;

        let ctx = AppCtx::test_ctx();
        let project = ctx
            .db
            .call({
                let path = dir.to_string_lossy().into_owned();
                move |db| db.projects.create(&path, Some("widgets"))
            })
            .await
            .unwrap();

        let (status, body) =
            read(github_remotes(State(ctx), Path(project.id), Query(ChatIdQuery::default())).await)
                .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["data"]["remotes"], serde_json::json!([]));
    }
}
