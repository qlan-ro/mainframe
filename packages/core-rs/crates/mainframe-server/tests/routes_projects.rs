//! Integration tests for `routes/projects.rs`. No TS supertest file exists for
//! projects.ts; these cover the DB-backed endpoints (list/get/create/409) and
//! pin the Phase-4/5 DELETE seam.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::StatusCode;
use serde_json::json;
use support::spawn_test_server;

#[tokio::test]
async fn list_starts_empty() {
    let server = spawn_test_server(None).await;
    let body: serde_json::Value = reqwest::get(server.http_url("/api/projects"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body, json!({ "success": true, "data": [] }));
}

#[tokio::test]
async fn create_then_get_by_id() {
    let server = spawn_test_server(None).await;
    let created: serde_json::Value = reqwest::Client::new()
        .post(server.http_url("/api/projects"))
        .json(&json!({ "path": "/tmp/proj-a", "name": "Proj A" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(created["success"], true);
    let id = created["data"]["id"].as_str().unwrap();

    let fetched: serde_json::Value = reqwest::get(server.http_url(&format!("/api/projects/{id}")))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(fetched["data"]["path"], "/tmp/proj-a");
    assert_eq!(fetched["data"]["name"], "Proj A");
}

#[tokio::test]
async fn get_missing_returns_404() {
    let server = spawn_test_server(None).await;
    let resp = reqwest::get(server.http_url("/api/projects/does-not-exist"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(
        body,
        json!({ "success": false, "error": "Project not found" })
    );
}

#[tokio::test]
async fn create_missing_path_returns_400() {
    let server = spawn_test_server(None).await;
    let resp = reqwest::Client::new()
        .post(server.http_url("/api/projects"))
        .json(&json!({ "name": "no path" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    // Byte-identical to Zod v4's `validate()` message (no field prefix).
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(
        body["error"],
        "Invalid input: expected string, received undefined"
    );
}

#[tokio::test]
async fn create_empty_path_returns_400_zod_message() {
    let server = spawn_test_server(None).await;
    let resp = reqwest::Client::new()
        .post(server.http_url("/api/projects"))
        .json(&json!({ "path": "" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(
        body["error"],
        "Too small: expected string to have >=1 characters"
    );
}

#[tokio::test]
async fn create_duplicate_path_returns_409_with_existing() {
    let server = spawn_test_server(None).await;
    let client = reqwest::Client::new();
    let first: serde_json::Value = client
        .post(server.http_url("/api/projects"))
        .json(&json!({ "path": "/tmp/proj-dup" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let existing_id = first["data"]["id"].as_str().unwrap().to_string();

    let resp = client
        .post(server.http_url("/api/projects"))
        .json(&json!({ "path": "/tmp/proj-dup" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["success"], false);
    assert_eq!(body["error"], "Project already registered");
    assert_eq!(body["data"]["id"], existing_id);
}

// Phase-4/5 seam: DELETE relies on ChatManager.removeProject (session + worktree
// teardown), which is not on AppCtx yet. Pins the seam's failure response.
#[tokio::test]
async fn delete_is_phase4_seam_returns_500() {
    let server = spawn_test_server(None).await;
    let created: serde_json::Value = reqwest::Client::new()
        .post(server.http_url("/api/projects"))
        .json(&json!({ "path": "/tmp/proj-del" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id = created["data"]["id"].as_str().unwrap();
    let resp = reqwest::Client::new()
        .delete(server.http_url(&format!("/api/projects/{id}")))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
