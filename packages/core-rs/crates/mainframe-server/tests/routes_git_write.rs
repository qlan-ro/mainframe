//! Route tests for `git_write.rs` — the commit + working-stat assertions from
//! `git-review.test.ts` (translated onto real git repos instead of a mocked
//! `GitService`), plus branch listing/creation coverage. Real collaborators: a
//! temp git repo per test, a real in-memory DB project row.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;

use reqwest::StatusCode;
use serde_json::{Value, json};
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

/// Init a repo with one commit, using repo-local identity/no-sign config so the
/// daemon's own `GitService` commits succeed regardless of the host git config.
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

async fn post(server: &TestServer, path: &str, body: Value) -> reqwest::Response {
    reqwest::Client::new()
        .post(server.http_url(path))
        .json(&body)
        .send()
        .await
        .unwrap()
}

// ── POST /api/projects/:id/git/commit ────────────────────────────────────────

#[tokio::test]
async fn commit_returns_404_when_project_not_found() {
    let server = spawn_test_server(None).await;
    let res = post(
        &server,
        "/api/projects/nope/git/commit",
        json!({ "message": "feat: something" }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert_eq!(res.json::<Value>().await.unwrap()["success"], false);
}

#[tokio::test]
async fn commit_returns_400_when_message_empty() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let res = post(
        &server,
        &format!("/api/projects/{id}/git/commit"),
        json!({ "message": "" }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(res.json::<Value>().await.unwrap()["success"], false);
}

#[tokio::test]
async fn commit_returns_400_when_message_missing() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let res = post(
        &server,
        &format!("/api/projects/{id}/git/commit"),
        json!({}),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(res.json::<Value>().await.unwrap()["success"], false);
}

#[tokio::test]
async fn commit_returns_success_with_commit_hash() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    std::fs::write(repo.path().join("new.txt"), "content\n").unwrap();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let res = post(
        &server,
        &format!("/api/projects/{id}/git/commit"),
        json!({ "message": "feat: add something" }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["success"], true);
    let commit = body["data"]["commit"].as_str().unwrap();
    assert_eq!(commit.len(), 40, "full 40-char sha: {commit}");
}

#[tokio::test]
async fn commit_returns_500_with_leaked_message_when_nothing_to_commit() {
    // Translated from git-review.test.ts's mocked "commitAll throws" case. With a
    // real repo the clean-tree commit fails at git itself (exit 1), so the leaked
    // message is git's exec error rather than the mock's literal "Nothing to
    // commit" — the contract under test is 500 + `success:false` + a leaked,
    // non-opaque git message (NOT the "Internal server error" async_err handler).
    let server = spawn_test_server(None).await;
    let repo = init_repo(); // clean tree → commit fails
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let res = post(
        &server,
        &format!("/api/projects/{id}/git/commit"),
        json!({ "message": "feat: something" }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["success"], false);
    let error = body["error"].as_str().unwrap();
    assert!(!error.is_empty(), "git error message is leaked, not opaque");
    assert_ne!(error, "Internal server error", "message must be leaked");
    assert!(error.contains("commit"), "leaked git failure: {error}");
}

// ── GET /api/projects/:id/git/branches ───────────────────────────────────────

#[tokio::test]
async fn branches_lists_the_current_branch() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let res = reqwest::get(server.http_url(&format!("/api/projects/{id}/git/branches")))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["success"], true);
    assert_eq!(body["data"]["current"], "main");
}

#[tokio::test]
async fn branches_returns_404_when_project_not_found() {
    let server = spawn_test_server(None).await;
    let res = reqwest::get(server.http_url("/api/projects/nope/git/branches"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert_eq!(res.json::<Value>().await.unwrap()["success"], false);
}

// ── POST /api/projects/:id/git/branch (create) ───────────────────────────────

#[tokio::test]
async fn create_branch_succeeds_and_switches() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let res = post(
        &server,
        &format!("/api/projects/{id}/git/branch"),
        json!({ "name": "feature/x" }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.json::<Value>().await.unwrap(),
        json!({ "success": true })
    );

    let branch = reqwest::get(server.http_url(&format!("/api/projects/{id}/git/branch")))
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(branch["data"]["branch"], "feature/x");
}

#[tokio::test]
async fn create_branch_rejects_invalid_name() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let res = post(
        &server,
        &format!("/api/projects/{id}/git/branch"),
        json!({ "name": "-bad" }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(res.json::<Value>().await.unwrap()["success"], false);
}
