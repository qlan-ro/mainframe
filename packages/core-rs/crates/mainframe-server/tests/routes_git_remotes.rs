//! Route tests for `git_remotes.rs` — `GET /api/projects/:id/git/github-remotes`.
//! Real git repos, real DB project rows, no mocks.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::StatusCode;
use support::spawn_test_server;

use support::helpers::run_git;

use support::helpers::init_repo;

use support::helpers::get_json;

#[tokio::test]
async fn github_remotes_returns_404_for_an_unknown_project() {
    let server = spawn_test_server(None).await;
    let (status, body) = get_json(&server, "/api/projects/nope/git/github-remotes").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["success"], false);
}

#[tokio::test]
async fn github_remotes_returns_empty_when_no_github_remote_is_configured() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    run_git(
        repo.path(),
        &["remote", "add", "origin", "git@gitlab.com:o/r.git"],
    );
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let (status, body) = get_json(&server, &format!("/api/projects/{id}/git/github-remotes")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        serde_json::json!({ "success": true, "data": { "remotes": [] } })
    );
}

#[tokio::test]
async fn github_remotes_returns_only_valid_github_remotes() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    run_git(
        repo.path(),
        &[
            "remote",
            "add",
            "origin",
            "https://github.com/acme/widgets.git",
        ],
    );
    run_git(
        repo.path(),
        &["remote", "add", "gitlab", "git@gitlab.com:acme/widgets.git"],
    );
    run_git(
        repo.path(),
        &[
            "remote",
            "add",
            "upstream",
            "git@github.com:upstream-org/widgets.git",
        ],
    );
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let (status, body) = get_json(&server, &format!("/api/projects/{id}/git/github-remotes")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], true);
    let remotes = body["data"]["remotes"].as_array().unwrap();
    assert_eq!(remotes.len(), 2);
    assert!(
        remotes
            .iter()
            .any(|r| { r["name"] == "origin" && r["owner"] == "acme" && r["repo"] == "widgets" })
    );
    assert!(remotes.iter().any(|r| {
        r["name"] == "upstream" && r["owner"] == "upstream-org" && r["repo"] == "widgets"
    }));
    assert!(!remotes.iter().any(|r| r["name"] == "gitlab"));
}
