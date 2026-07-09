//! Integration tests for `routes/files.rs`, translated assertion-for-assertion
//! from `server/routes/__tests__/files.test.ts`. Real spawned app + real
//! in-memory DB + real tempdir project (no mocks); the TS `db.projects.get`
//! stub becomes a real project row, its `chats.getChat → null` stub is the
//! absence of any chat.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::StatusCode;
use serde_json::{Value, json};
use support::{TestServer, spawn_test_server};
use tempfile::TempDir;

/// Spawn a server with a real project whose path is a tempdir containing
/// `hello.txt` and an empty `subdir/`. Returns the kept-alive tempdir + id.
async fn project_server() -> (TestServer, String, TempDir) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("hello.txt"), "hello world\n").unwrap();
    std::fs::create_dir(dir.path().join("subdir")).unwrap();
    let server = spawn_test_server(None).await;
    let id = server.create_project(&dir.path().to_string_lossy()).await;
    (server, id, dir)
}

async fn get(server: &TestServer, path: &str) -> (StatusCode, Value) {
    let resp = reqwest::get(server.http_url(path)).await.unwrap();
    let status = resp.status();
    let body = resp.json::<Value>().await.unwrap();
    (status, body)
}

// ── handleTree ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn tree_returns_404_envelope_when_project_not_found() {
    let server = spawn_test_server(None).await;
    let (status, body) = get(&server, "/api/projects/missing/tree?path=.").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        json!({ "success": false, "error": "Project not found" })
    );
}

#[tokio::test]
async fn tree_returns_array_wrapped_in_envelope_on_success() {
    let (server, id, _dir) = project_server().await;
    let (status, body) = get(&server, &format!("/api/projects/{id}/tree?path=.")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], true);
    let names: Vec<&str> = body["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"hello.txt"));
    assert!(names.contains(&"subdir"));
}

#[tokio::test]
async fn tree_returns_403_envelope_when_path_is_outside_project() {
    let (server, id, _dir) = project_server().await;
    let (status, body) = get(&server, &format!("/api/projects/{id}/tree?path=../../etc")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body,
        json!({ "success": false, "error": "Path outside project" })
    );
}

// ── handleFileContent ────────────────────────────────────────────────────────

#[tokio::test]
async fn file_content_returns_content_wrapped_in_envelope_on_success() {
    let (server, id, _dir) = project_server().await;
    let (status, body) = get(&server, &format!("/api/projects/{id}/files?path=hello.txt")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], true);
    assert_eq!(
        body["data"],
        json!({ "path": "hello.txt", "content": "hello world\n" })
    );
}

#[tokio::test]
async fn file_content_returns_403_when_file_path_is_outside_project() {
    let (server, id, _dir) = project_server().await;
    let (status, body) = get(
        &server,
        &format!("/api/projects/{id}/files?path=../../etc/passwd"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body,
        json!({ "success": false, "error": "Path outside project" })
    );
}

#[tokio::test]
async fn file_content_returns_404_when_project_not_found() {
    let server = spawn_test_server(None).await;
    let (status, body) = get(&server, "/api/projects/missing/files?path=hello.txt").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        json!({ "success": false, "error": "Project not found" })
    );
}

// ── handleSearchFiles ────────────────────────────────────────────────────────

#[tokio::test]
async fn search_files_returns_empty_array_for_empty_query() {
    let (server, id, _dir) = project_server().await;
    let (status, body) = get(&server, &format!("/api/projects/{id}/search/files?q=")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true, "data": [] }));
}

#[tokio::test]
async fn search_files_returns_matching_files_in_envelope() {
    let (server, id, _dir) = project_server().await;
    let (status, body) = get(&server, &format!("/api/projects/{id}/search/files?q=hello")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], true);
    assert!(body["data"].is_array());
    let names: Vec<&str> = body["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"hello.txt"));
}
