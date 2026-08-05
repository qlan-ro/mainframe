//! Route tests for `git_remotes.rs` — `GET /api/projects/:id/git/github-remotes`.
//! Real git repos, real DB project rows, no mocks.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;

use reqwest::StatusCode;
use serde_json::Value;
use support::{TestServer, spawn_test_server};

fn run_git(cwd: &Path, args: &[&str]) {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn init_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    run_git(dir.path(), &["init", "-b", "main"]);
    run_git(dir.path(), &["config", "user.email", "t@t.com"]);
    run_git(dir.path(), &["config", "user.name", "T"]);
    run_git(dir.path(), &["config", "commit.gpgsign", "false"]);
    std::fs::write(dir.path().join("README.md"), "hello\n").unwrap();
    run_git(dir.path(), &["add", "-A"]);
    run_git(dir.path(), &["commit", "-m", "init"]);
    dir
}

async fn get_json(server: &TestServer, path: &str) -> (StatusCode, Value) {
    let res = reqwest::get(server.http_url(path)).await.unwrap();
    let status = res.status();
    (status, res.json().await.unwrap())
}

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
