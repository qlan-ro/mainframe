//! Integration tests for `routes/search.rs`, translated from
//! `server/routes/__tests__/search.test.ts` and `search-symlink-fallback.test.ts`.
//! Real spawned app + in-memory DB + tempdir project. The symlink-containment
//! specs exercise the in-process searcher's default (`ignore::WalkBuilder`
//! never follows symlinks), so the leaked file is never read.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::process::Command;

use reqwest::StatusCode;
use serde_json::{Value, json};
use support::{TestServer, spawn_test_server};
use tempfile::TempDir;

async fn get(server: &TestServer, path: &str) -> (StatusCode, Value) {
    let resp = reqwest::get(server.http_url(path)).await.unwrap();
    let status = resp.status();
    let body = resp.json::<Value>().await.unwrap();
    (status, body)
}

/// Project tempdir with a single `sample.txt` = "hello world\n".
async fn sample_server() -> (TestServer, String, TempDir) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("sample.txt"), "hello world\n").unwrap();
    let server = spawn_test_server(None).await;
    let id = server.create_project(&dir.path().to_string_lossy()).await;
    (server, id, dir)
}

// ── content search envelope ──────────────────────────────────────────────────

#[tokio::test]
async fn returns_404_when_project_not_found() {
    let server = spawn_test_server(None).await;
    let (status, body) = get(
        &server,
        "/api/projects/missing/search/content?q=hello&path=.",
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        json!({ "success": false, "error": "Project not found" })
    );
}

#[tokio::test]
async fn returns_200_envelope_for_a_valid_search() {
    let (server, id, _dir) = sample_server().await;
    let (status, body) = get(
        &server,
        &format!("/api/projects/{id}/search/content?q=hello&path=sample.txt"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], true);
    assert!(body["data"]["results"].is_array());
}

#[tokio::test]
async fn returns_403_when_path_is_outside_project() {
    let (server, id, _dir) = sample_server().await;
    let (status, body) = get(
        &server,
        &format!("/api/projects/{id}/search/content?q=hello&path=../etc"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body,
        json!({ "success": false, "error": "Path outside project" })
    );
}

#[tokio::test]
async fn returns_400_when_query_is_too_short() {
    let (server, id, _dir) = sample_server().await;
    let (status, body) = get(
        &server,
        &format!("/api/projects/{id}/search/content?q=a&path=."),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["success"], false);
    assert!(body["error"].is_string());
}

// ── JS fallback symlink containment ──────────────────────────────────────────

/// Git repo with an in-repo symlink `leak.txt` that escapes to `outside/secret.txt`,
/// plus a legitimate `normal.txt`. Returns (server, id, project dir, outside dir).
async fn symlink_repo() -> (TestServer, String, TempDir, TempDir) {
    let project = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret.txt"), "TOPSECRETVALUE\n").unwrap();
    std::fs::write(project.path().join("normal.txt"), "ordinary content\n").unwrap();
    std::os::unix::fs::symlink(
        outside.path().join("secret.txt"),
        project.path().join("leak.txt"),
    )
    .unwrap();
    for args in [["init", "-q"].as_slice(), ["add", "-A"].as_slice()] {
        Command::new("git")
            .args(args)
            .current_dir(project.path())
            .status()
            .unwrap();
    }
    let server = spawn_test_server(None).await;
    let id = server
        .create_project(&project.path().to_string_lossy())
        .await;
    (server, id, project, outside)
}

#[tokio::test]
async fn does_not_read_a_file_via_an_in_repo_symlink_that_escapes_the_project() {
    let (server, id, _project, _outside) = symlink_repo().await;
    let (status, body) = get(
        &server,
        &format!("/api/projects/{id}/search/content?q=TOPSECRETVALUE&path=."),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["results"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn still_searches_legitimate_in_project_files() {
    let (server, id, _project, _outside) = symlink_repo().await;
    let (status, body) = get(
        &server,
        &format!("/api/projects/{id}/search/content?q=ordinary&path=."),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(!body["data"]["results"].as_array().unwrap().is_empty());
}
