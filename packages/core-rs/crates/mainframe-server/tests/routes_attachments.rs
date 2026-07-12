//! Route tests for `attachments.rs` — translated assertion-for-assertion from
//! `src/server/routes/__tests__/attachments.test.ts`, against a real spawned app
//! with a real `AttachmentStore` (no mocks).
//!
//! The two TS "attachment store not configured" 500 cases are omitted: the Rust
//! `AppCtx` always carries an `Arc<AttachmentStore>`, so that branch is
//! structurally unreachable.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::StatusCode;
use serde_json::{Value, json};
use support::spawn_test_server;

/// base64("hello") — the TS `smallImage.data`.
const SMALL_IMAGE_DATA: &str = "aGVsbG8=";

fn small_image() -> Value {
    json!({ "name": "a.png", "mediaType": "image/png", "data": SMALL_IMAGE_DATA })
}

async fn post_attachments(
    server: &support::TestServer,
    chat: &str,
    body: Value,
) -> reqwest::Response {
    reqwest::Client::new()
        .post(server.http_url(&format!("/api/chats/{chat}/attachments")))
        .json(&body)
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn returns_400_when_attachments_array_is_empty() {
    let server = spawn_test_server(None).await;
    let res = post_attachments(&server, "c1", json!({ "attachments": [] })).await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["success"], false);
}

#[tokio::test]
async fn returns_400_when_more_than_10_attachments() {
    let server = spawn_test_server(None).await;
    let attachments: Vec<Value> = (0..11)
        .map(|i| json!({ "name": format!("a{i}.png"), "mediaType": "image/png", "data": SMALL_IMAGE_DATA }))
        .collect();
    let res = post_attachments(&server, "c1", json!({ "attachments": attachments })).await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(res.json::<Value>().await.unwrap()["success"], false);
}

#[tokio::test]
async fn returns_400_when_media_type_is_empty_string() {
    let server = spawn_test_server(None).await;
    let mut item = small_image();
    item["mediaType"] = json!("");
    let res = post_attachments(&server, "c1", json!({ "attachments": [item] })).await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(res.json::<Value>().await.unwrap()["success"], false);
}

#[tokio::test]
async fn returns_400_when_media_type_is_missing() {
    let server = spawn_test_server(None).await;
    let res = post_attachments(
        &server,
        "c1",
        json!({ "attachments": [{ "name": "a.png", "data": SMALL_IMAGE_DATA }] }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(res.json::<Value>().await.unwrap()["success"], false);
}

#[tokio::test]
async fn returns_400_when_declared_size_exceeds_5mb() {
    let server = spawn_test_server(None).await;
    let mut item = small_image();
    item["sizeBytes"] = json!(6 * 1024 * 1024);
    let res = post_attachments(&server, "c1", json!({ "attachments": [item] })).await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let body: Value = res.json().await.unwrap();
    assert_eq!(
        body,
        json!({ "success": false, "error": "Attachment exceeds 5MB limit" })
    );
}

#[tokio::test]
#[ignore = "http.rs applies RequestBodyLimitLayer(30mb) but not DefaultBodyLimit::disable(), \
            so axum's built-in 2MB extractor limit shadows it and this >2MB body is rejected \
            with 413 before reaching the handler (would be 400 under the TS 30mb limit). \
            Un-ignore once http.rs disables the default body limit — reported as a blocker."]
async fn returns_400_when_base64_payload_exceeds_5mb() {
    let server = spawn_test_server(None).await;
    // 8MB of valid base64 chars → computed floor(len*3/4) = 6MB > 5MB.
    let oversized = "A".repeat(8 * 1024 * 1024);
    let res = post_attachments(
        &server,
        "c1",
        json!({ "attachments": [{ "name": "big.bin", "mediaType": "application/octet-stream", "data": oversized }] }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let body: Value = res.json().await.unwrap();
    assert_eq!(
        body,
        json!({ "success": false, "error": "Attachment exceeds 5MB limit" })
    );
}

#[tokio::test]
async fn saves_a_valid_attachment_and_returns_metadata() {
    let server = spawn_test_server(None).await;
    let res = post_attachments(&server, "c1", json!({ "attachments": [small_image()] })).await;
    assert_eq!(res.status(), StatusCode::OK);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["success"], true);
    let attachments = body["data"]["attachments"].as_array().unwrap();
    assert_eq!(attachments.len(), 1);
    assert_eq!(attachments[0]["name"], "a.png");
    assert_eq!(attachments[0]["mediaType"], "image/png");
    assert_eq!(attachments[0]["kind"], "image");
    assert!(attachments[0]["id"].is_string());
}

#[tokio::test]
async fn defaults_kind_to_file_for_non_image_media_type() {
    let server = spawn_test_server(None).await;
    let res = post_attachments(
        &server,
        "c1",
        json!({ "attachments": [{ "name": "doc.txt", "mediaType": "text/plain", "data": "aGVsbG8=" }] }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["data"]["attachments"][0]["kind"], "file");
}

#[tokio::test]
async fn get_returns_404_when_attachment_does_not_exist() {
    let server = spawn_test_server(None).await;
    let res = reqwest::get(server.http_url("/api/chats/c1/attachments/missing"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    let body: Value = res.json().await.unwrap();
    assert_eq!(
        body,
        json!({ "success": false, "error": "Attachment not found" })
    );
}

#[tokio::test]
async fn get_returns_the_stored_attachment_in_the_envelope() {
    let server = spawn_test_server(None).await;
    let upload = post_attachments(&server, "c1", json!({ "attachments": [small_image()] })).await;
    let upload_body: Value = upload.json().await.unwrap();
    let id = upload_body["data"]["attachments"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let res = reqwest::get(server.http_url(&format!("/api/chats/c1/attachments/{id}")))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["success"], true);
    assert_eq!(body["data"]["name"], "a.png");
    assert_eq!(body["data"]["mediaType"], "image/png");
}
