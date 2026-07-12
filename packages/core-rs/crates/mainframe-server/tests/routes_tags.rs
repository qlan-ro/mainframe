//! Integration tests for `routes/tags.rs` — translated assertion-for-assertion
//! from `src/server/routes/__tests__/tags.test.ts` (real in-memory DB, a seeded
//! project + chat for the chat-scoped routes).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::StatusCode;
use serde_json::json;
use support::{TestServer, spawn_test_server};

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

/// Seed a project + chat (FK-required for the chat_tags routes); return chat id.
async fn seed_chat(server: &TestServer) -> String {
    server
        .ctx
        .db
        .call(|db| {
            let project = db.projects.create("/tmp/tags-proj", Some("p"))?;
            let chat = db.chats.create(&project.id, "claude", None, None)?;
            Ok(chat.id)
        })
        .await
        .unwrap()
}

#[tokio::test]
async fn get_tags_returns_empty() {
    let server = spawn_test_server(None).await;
    let body: serde_json::Value = reqwest::get(server.http_url("/api/tags"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body["data"], json!([]));
}

#[tokio::test]
async fn post_creates_a_tag() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .post(server.http_url("/api/tags"))
        .json(&json!({ "name": "feature" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["data"]["name"], "feature");
    assert!(body["data"]["color"].as_str().is_some());
}

#[tokio::test]
async fn post_rejects_has_prefix() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .post(server.http_url("/api/tags"))
        .json(&json!({ "name": "has-foo" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn post_rejects_invalid_color_enum() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .post(server.http_url("/api/tags"))
        .json(&json!({ "name": "feature", "color": "not-a-color" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn patch_renames() {
    let server = spawn_test_server(None).await;
    server
        .ctx
        .db
        .call(|db| db.tags.upsert("feat", None))
        .await
        .unwrap();
    let resp = client()
        .patch(server.http_url("/api/tags/feat"))
        .json(&json!({ "rename": "feature" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let has_feature = server
        .ctx
        .db
        .call(|db| db.tags.get("feature"))
        .await
        .unwrap();
    let has_feat = server.ctx.db.call(|db| db.tags.get("feat")).await.unwrap();
    assert!(has_feature.is_some());
    assert!(has_feat.is_none());
}

#[tokio::test]
async fn patch_missing_returns_404() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .patch(server.http_url("/api/tags/nope"))
        .json(&json!({ "color": "red" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn patch_empty_body_returns_400() {
    let server = spawn_test_server(None).await;
    server
        .ctx
        .db
        .call(|db| db.tags.upsert("feature", None))
        .await
        .unwrap();
    let resp = client()
        .patch(server.http_url("/api/tags/feature"))
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn patch_updates_color_only() {
    let server = spawn_test_server(None).await;
    server
        .ctx
        .db
        .call(|db| db.tags.upsert("feature", None))
        .await
        .unwrap();
    let resp = client()
        .patch(server.http_url("/api/tags/feature"))
        .json(&json!({ "color": "red" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["data"]["color"], "red");
    let tag = server
        .ctx
        .db
        .call(|db| db.tags.get("feature"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(serde_json::to_value(tag.color).unwrap(), json!("red"));
}

#[tokio::test]
async fn patch_applies_rename_and_color() {
    let server = spawn_test_server(None).await;
    server
        .ctx
        .db
        .call(|db| db.tags.upsert("feat", None))
        .await
        .unwrap();
    let resp = client()
        .patch(server.http_url("/api/tags/feat"))
        .json(&json!({ "rename": "feature", "color": "red" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["data"]["name"], "feature");
    assert_eq!(body["data"]["color"], "red");
    let has_feat = server.ctx.db.call(|db| db.tags.get("feat")).await.unwrap();
    assert!(has_feat.is_none());
}

#[tokio::test]
async fn delete_removes_with_empty_204_body() {
    let server = spawn_test_server(None).await;
    server
        .ctx
        .db
        .call(|db| db.tags.upsert("feature", None))
        .await
        .unwrap();
    let resp = client()
        .delete(server.http_url("/api/tags/feature"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    let text = resp.text().await.unwrap();
    assert_eq!(text, "");
    let gone = server
        .ctx
        .db
        .call(|db| db.tags.get("feature"))
        .await
        .unwrap();
    assert!(gone.is_none());
}

#[tokio::test]
async fn delete_missing_returns_404() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .delete(server.http_url("/api/tags/nope"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn get_chat_tags_returns_empty() {
    let server = spawn_test_server(None).await;
    let chat_id = seed_chat(&server).await;
    let body: serde_json::Value =
        reqwest::get(server.http_url(&format!("/api/chats/{chat_id}/tags")))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    assert_eq!(body["data"], json!([]));
}

#[tokio::test]
async fn put_chat_tags_applies_tags() {
    let server = spawn_test_server(None).await;
    let chat_id = seed_chat(&server).await;
    let body: serde_json::Value = client()
        .put(server.http_url(&format!("/api/chats/{chat_id}/tags")))
        .json(&json!({ "tags": ["feature", "ui"] }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let mut tags: Vec<String> = body["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    tags.sort();
    assert_eq!(tags, vec!["feature".to_string(), "ui".to_string()]);
}

#[tokio::test]
async fn put_chat_tags_rejects_reserved_prefix() {
    let server = spawn_test_server(None).await;
    let chat_id = seed_chat(&server).await;
    let resp = client()
        .put(server.http_url(&format!("/api/chats/{chat_id}/tags")))
        .json(&json!({ "tags": ["has-pr"] }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn patch_rename_cascades_to_tagged_chats() {
    let server = spawn_test_server(None).await;
    let chat_id = seed_chat(&server).await;
    client()
        .put(server.http_url(&format!("/api/chats/{chat_id}/tags")))
        .json(&json!({ "tags": ["feat"] }))
        .send()
        .await
        .unwrap();
    let resp = client()
        .patch(server.http_url("/api/tags/feat"))
        .json(&json!({ "rename": "feature" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let chat_tags: serde_json::Value =
        reqwest::get(server.http_url(&format!("/api/chats/{chat_id}/tags")))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    assert_eq!(chat_tags["data"], json!(["feature"]));
}
