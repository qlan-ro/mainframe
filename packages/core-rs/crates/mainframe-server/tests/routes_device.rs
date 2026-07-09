//! Integration tests for `routes/device.rs` — POST /api/device/activity. No TS
//! supertest file exists for device.ts; these pin the contract (200 on a valid
//! state enum, 400 otherwise) and confirm the push service sees the transition.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::StatusCode;
use serde_json::json;
use support::spawn_test_server;

#[tokio::test]
async fn activity_active_returns_200() {
    let server = spawn_test_server(None).await;
    let resp = reqwest::Client::new()
        .post(server.http_url("/api/device/activity"))
        .json(&json!({ "state": "active" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body, json!({ "success": true }));
}

#[tokio::test]
async fn activity_idle_returns_200() {
    let server = spawn_test_server(None).await;
    let resp = reqwest::Client::new()
        .post(server.http_url("/api/device/activity"))
        .json(&json!({ "state": "idle" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn activity_rejects_invalid_state() {
    let server = spawn_test_server(None).await;
    let resp = reqwest::Client::new()
        .post(server.http_url("/api/device/activity"))
        .json(&json!({ "state": "sleeping" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["success"], false);
}

#[tokio::test]
async fn activity_rejects_missing_state() {
    let server = spawn_test_server(None).await;
    let resp = reqwest::Client::new()
        .post(server.http_url("/api/device/activity"))
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}
