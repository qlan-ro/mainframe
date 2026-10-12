use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use tokio::process::Command;

use super::super::git::ChatIdQuery;
use super::super::git_remotes::github_remotes;
use crate::ctx::AppCtx;

use crate::test_support::read_json as read;

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
        .core
        .db
        .call({
            let path = dir.to_string_lossy().into_owned();
            move |db| db.projects.create(&path, Some("widgets"))
        })
        .await
        .unwrap();

    let (status, body) =
        read(github_remotes(State(ctx), Path(project.id), Query(ChatIdQuery::default())).await)
            .await
            .unwrap();

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
    .await
    .unwrap();
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
        .core
        .db
        .call({
            let path = dir.to_string_lossy().into_owned();
            move |db| db.projects.create(&path, Some("widgets"))
        })
        .await
        .unwrap();

    let (status, body) =
        read(github_remotes(State(ctx), Path(project.id), Query(ChatIdQuery::default())).await)
            .await
            .unwrap();

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["remotes"], serde_json::json!([]));
}
