//! Route tests for `git.rs` — the 5 read endpoints, including the working-stat
//! assertions from `git-review.test.ts` and the git-read soft-error envelopes
//! (status/branch fall back to `success:true` on a non-git dir). Real git repos,
//! real DB project rows, no mocks.
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

// ── working-stat ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn working_stat_returns_404_when_project_not_found() {
    let server = spawn_test_server(None).await;
    let (status, body) = get_json(&server, "/api/projects/nope/git/working-stat").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["success"], false);
}

#[tokio::test]
async fn working_stat_returns_stat_data() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    std::fs::write(repo.path().join("README.md"), "hello\nworld\nmore\n").unwrap();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let (status, body) = get_json(&server, &format!("/api/projects/{id}/git/working-stat")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], true);
    assert!(body["data"]["totalAdditions"].as_i64().unwrap() >= 2);
    assert_eq!(body["data"]["files"][0]["path"], "README.md");
}

// ── status ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn status_returns_changed_files() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    std::fs::write(repo.path().join("README.md"), "changed\n").unwrap();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let (status, body) = get_json(&server, &format!("/api/projects/{id}/git/status")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], true);
    let files = body["data"]["files"].as_array().unwrap();
    assert!(files.iter().any(|f| f["path"] == "README.md"));
}

#[tokio::test]
async fn status_soft_errors_for_a_non_git_directory() {
    let server = spawn_test_server(None).await;
    let plain = tempfile::tempdir().unwrap();
    let id = server.create_project(plain.path().to_str().unwrap()).await;
    let (status, body) = get_json(&server, &format!("/api/projects/{id}/git/status")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        serde_json::json!({ "success": true, "data": { "files": [], "error": "Not a git repository" } })
    );
}

// ── branch ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn branch_returns_current_branch() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let (status, body) = get_json(&server, &format!("/api/projects/{id}/git/branch")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        serde_json::json!({ "success": true, "data": { "branch": "main" } })
    );
}

#[tokio::test]
async fn branch_soft_errors_to_null_for_a_non_git_directory() {
    let server = spawn_test_server(None).await;
    let plain = tempfile::tempdir().unwrap();
    let id = server.create_project(plain.path().to_str().unwrap()).await;
    let (status, body) = get_json(&server, &format!("/api/projects/{id}/git/branch")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        serde_json::json!({ "success": true, "data": { "branch": null } })
    );
}

// ── branch-diffs ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn branch_diffs_lists_committed_changes_vs_base() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    run_git(repo.path(), &["checkout", "-b", "feature"]);
    std::fs::write(repo.path().join("feature.txt"), "x\n").unwrap();
    run_git(repo.path(), &["add", "-A"]);
    run_git(repo.path(), &["commit", "-m", "add feature"]);
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let (status, body) = get_json(&server, &format!("/api/projects/{id}/git/branch-diffs")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], true);
    assert_eq!(body["data"]["branch"], "feature");
    assert_eq!(body["data"]["baseBranch"], "main");
    let files = body["data"]["files"].as_array().unwrap();
    assert!(files.iter().any(|f| f["path"] == "feature.txt"));
}

// ── diff ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn diff_returns_original_and_modified_for_a_changed_file() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    std::fs::write(repo.path().join("README.md"), "hello\nchanged\n").unwrap();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let (status, body) = get_json(
        &server,
        &format!("/api/projects/{id}/git/diff?file=README.md"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], true);
    assert_eq!(body["data"]["source"], "git");
    assert_eq!(body["data"]["original"], "hello\n");
    assert_eq!(body["data"]["modified"], "hello\nchanged\n");
    assert!(body["data"]["diff"].as_str().unwrap().contains("README.md"));
}

#[tokio::test]
async fn diff_returns_403_for_a_path_outside_the_project() {
    let server = spawn_test_server(None).await;
    let repo = init_repo(); // ghost.txt does not exist → resolve_and_validate_path → None → 403
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let (status, body) = get_json(
        &server,
        &format!("/api/projects/{id}/git/diff?file=ghost.txt"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body,
        serde_json::json!({ "success": false, "error": "Path outside project" })
    );
}

#[tokio::test]
async fn diff_rejects_a_non_git_source() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let (status, body) =
        get_json(&server, &format!("/api/projects/{id}/git/diff?source=svn")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["success"], false);
}
