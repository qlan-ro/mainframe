//! Integration tests for `routes/suggestions.rs`. Real spawned app + in-memory
//! DB + real git repos in a tempdir; ripgrep runs for real (resolved off PATH in
//! the test environment).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::StatusCode;
use serde_json::json;
use support::spawn_test_server;

use support::run_git;

fn init_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    run_git(dir.path(), &["init", "-b", "main"]);
    run_git(dir.path(), &["config", "user.email", "t@t.com"]);
    run_git(dir.path(), &["config", "user.name", "T"]);
    run_git(dir.path(), &["config", "commit.gpgsign", "false"]);
    std::fs::write(dir.path().join("file.txt"), "hello\n").unwrap();
    run_git(dir.path(), &["add", "-A"]);
    run_git(dir.path(), &["commit", "-m", "init"]);
    dir
}

use support::get_json;

#[tokio::test]
async fn returns_a_churn_suggestion_for_a_repo_with_uncommitted_changes() {
    let dir = init_repo();
    std::fs::write(dir.path().join("file.txt"), "hello\nmodified\n").unwrap();

    let server = spawn_test_server(None).await;
    let id = server.create_project(&dir.path().to_string_lossy()).await;

    let (status, body) = get_json(&server, &format!("/api/projects/{id}/suggestions")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({
            "success": true,
            "data": [
                {
                    "icon": "git-compare",
                    "tint": "accent",
                    "title": "Review the working changes",
                    "meta": "git · 1 file uncommitted",
                    "prefill": "Review the uncommitted changes in the working tree, summarize what they do, and flag anything unsafe to commit.",
                }
            ],
        })
    );
}

#[tokio::test]
async fn returns_success_true_with_empty_data_for_a_non_git_directory() {
    let dir = tempfile::tempdir().unwrap();

    let server = spawn_test_server(None).await;
    let id = server.create_project(&dir.path().to_string_lossy()).await;

    let (status, body) = get_json(&server, &format!("/api/projects/{id}/suggestions")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true, "data": [] }));
}

#[tokio::test]
async fn returns_404_when_the_project_is_not_found() {
    let server = spawn_test_server(None).await;
    let (status, body) = get_json(&server, "/api/projects/missing/suggestions").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        json!({ "success": false, "error": "Project not found" })
    );
}

#[tokio::test]
async fn returns_a_todo_suggestion_for_a_clean_repo_with_todo_comments() {
    let dir = init_repo();
    std::fs::write(dir.path().join("todo.txt"), "// TODO: fix this\n").unwrap();
    run_git(dir.path(), &["add", "-A"]);
    run_git(dir.path(), &["commit", "-m", "add todo"]);

    let server = spawn_test_server(None).await;
    let id = server.create_project(&dir.path().to_string_lossy()).await;

    let (status, body) = get_json(&server, &format!("/api/projects/{id}/suggestions")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({
            "success": true,
            "data": [
                {
                    "icon": "list-checks",
                    "tint": "amber",
                    "title": "Clean up the 1 TODO comments in the project root",
                    "meta": "code · 1 matches",
                    "prefill": "Find and address the TODO/FIXME comments in `the project root`.",
                }
            ],
        })
    );
}
