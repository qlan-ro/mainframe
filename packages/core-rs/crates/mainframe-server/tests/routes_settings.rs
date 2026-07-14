//! Integration tests for `routes/settings.rs` — translated from
//! `settings.test.ts` and `settings-notifications.test.ts`. The provider GET
//! cases assert the DB-derivable shape (skipPermissions→yolo, ghost adapter); the
//! TS `resolvedExecutable` enrichment + adapter-registry union are a Phase-4/5
//! seam, so those assertions pin the seam (resolvedExecutable absent).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use mainframe_types::settings::{GeneralConfig, NotificationConfig};
use reqwest::StatusCode;
use serde_json::json;
use support::{TestServer, spawn_test_server};

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

async fn set_setting(server: &TestServer, category: &str, key: &str, value: &str) {
    let (c, k, v) = (category.to_string(), key.to_string(), value.to_string());
    server
        .ctx
        .db
        .call(move |db| db.settings.set(&c, &k, &v))
        .await
        .unwrap();
}

async fn get_setting(server: &TestServer, category: &str, key: &str) -> Option<String> {
    let (c, k) = (category.to_string(), key.to_string());
    server
        .ctx
        .db
        .call(move |db| db.settings.get(&c, &k))
        .await
        .unwrap()
}

async fn get_json(server: &TestServer, path: &str) -> serde_json::Value {
    reqwest::get(server.http_url(path))
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
}

// ── general ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn general_returns_defaults_when_empty() {
    let server = spawn_test_server(None).await;
    let body = get_json(&server, "/api/settings/general").await;
    assert_eq!(
        body,
        json!({ "success": true, "data": GeneralConfig::default() })
    );
}

#[tokio::test]
async fn general_returns_stored_worktree_dir() {
    let server = spawn_test_server(None).await;
    set_setting(&server, "general", "worktreeDir", "my-worktrees").await;
    let body = get_json(&server, "/api/settings/general").await;
    assert_eq!(body["data"]["worktreeDir"], "my-worktrees");
}

#[tokio::test]
async fn general_put_persists_non_default_worktree_dir() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .put(server.http_url("/api/settings/general"))
        .json(&json!({ "worktreeDir": "custom-dir" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body, json!({ "success": true }));
    assert_eq!(
        get_setting(&server, "general", "worktreeDir")
            .await
            .as_deref(),
        Some("custom-dir")
    );
}

#[tokio::test]
async fn general_put_deletes_key_when_set_to_default() {
    let server = spawn_test_server(None).await;
    set_setting(&server, "general", "worktreeDir", "custom-dir").await;
    let resp = client()
        .put(server.http_url("/api/settings/general"))
        .json(&json!({ "worktreeDir": ".worktrees" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(get_setting(&server, "general", "worktreeDir").await, None);
}

#[tokio::test]
async fn general_put_rejects_worktree_dir_with_separators() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .put(server.http_url("/api/settings/general"))
        .json(&json!({ "worktreeDir": "../escape" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["success"], false);
    // worktreeDir regex-only failure → the bare Zod refinement message.
    assert_eq!(body["error"], "Must be a simple directory name");
}

#[tokio::test]
async fn general_put_rejects_empty_worktree_dir_with_joined_zod_message() {
    // An empty string trips BOTH `.min(1)` and the regex; `validate()` joins the
    // two issue messages with ", " (no field prefix).
    let server = spawn_test_server(None).await;
    let resp = client()
        .put(server.http_url("/api/settings/general"))
        .json(&json!({ "worktreeDir": "" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(
        body["error"],
        "Too small: expected string to have >=1 characters, Must be a simple directory name"
    );
}

#[tokio::test]
async fn general_put_persists_prerelease_channel() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .put(server.http_url("/api/settings/general"))
        .json(&json!({ "updateChannel": "prerelease" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        get_setting(&server, "general", "updateChannel")
            .await
            .as_deref(),
        Some("prerelease")
    );
    let body = get_json(&server, "/api/settings/general").await;
    assert_eq!(body["data"]["updateChannel"], "prerelease");
}

#[tokio::test]
async fn general_put_deletes_channel_key_when_set_to_default() {
    let server = spawn_test_server(None).await;
    set_setting(&server, "general", "updateChannel", "prerelease").await;
    let resp = client()
        .put(server.http_url("/api/settings/general"))
        .json(&json!({ "updateChannel": "stable" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(get_setting(&server, "general", "updateChannel").await, None);
}

#[tokio::test]
async fn general_put_rejects_invalid_update_channel() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .put(server.http_url("/api/settings/general"))
        .json(&json!({ "updateChannel": "bogus" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["success"], false);
    assert_eq!(body["error"], "Invalid update channel");
}

#[tokio::test]
async fn general_put_persists_default_adapter_id() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .put(server.http_url("/api/settings/general"))
        .json(&json!({ "defaultAdapterId": "gemini" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        get_setting(&server, "general", "defaultAdapterId")
            .await
            .as_deref(),
        Some("gemini")
    );
    let body = get_json(&server, "/api/settings/general").await;
    assert_eq!(body["data"]["defaultAdapterId"], "gemini");
}

#[tokio::test]
async fn general_put_clears_default_adapter_id_on_explicit_null() {
    let server = spawn_test_server(None).await;
    set_setting(&server, "general", "defaultAdapterId", "gemini").await;
    let resp = client()
        .put(server.http_url("/api/settings/general"))
        .json(&json!({ "defaultAdapterId": null }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        get_setting(&server, "general", "defaultAdapterId").await,
        None
    );
}

#[tokio::test]
async fn general_put_leaves_default_adapter_id_untouched_when_omitted() {
    let server = spawn_test_server(None).await;
    set_setting(&server, "general", "defaultAdapterId", "gemini").await;
    let resp = client()
        .put(server.http_url("/api/settings/general"))
        .json(&json!({ "worktreeDir": "custom-dir" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        get_setting(&server, "general", "defaultAdapterId")
            .await
            .as_deref(),
        Some("gemini")
    );
}

#[tokio::test]
async fn general_put_rejects_invalid_default_adapter_id() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .put(server.http_url("/api/settings/general"))
        .json(&json!({ "defaultAdapterId": "../escape" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["success"], false);
}

// ── providers PUT ────────────────────────────────────────────────────────────

#[tokio::test]
async fn provider_put_sets_default_model() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .put(server.http_url("/api/settings/providers/claude"))
        .json(&json!({ "defaultModel": "opus" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body, json!({ "success": true }));
    assert_eq!(
        get_setting(&server, "provider", "claude.defaultModel")
            .await
            .as_deref(),
        Some("opus")
    );
}

#[tokio::test]
async fn provider_put_clears_setting_on_empty_string() {
    let server = spawn_test_server(None).await;
    set_setting(&server, "provider", "claude.defaultEffort", "high").await;
    let resp = client()
        .put(server.http_url("/api/settings/providers/claude"))
        .json(&json!({ "defaultEffort": "" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        get_setting(&server, "provider", "claude.defaultEffort").await,
        None
    );
}

#[tokio::test]
async fn provider_put_clears_skip_permissions_on_default_mode() {
    let server = spawn_test_server(None).await;
    set_setting(&server, "provider", "claude.skipPermissions", "true").await;
    let resp = client()
        .put(server.http_url("/api/settings/providers/claude"))
        .json(&json!({ "defaultMode": "acceptEdits" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        get_setting(&server, "provider", "claude.defaultMode")
            .await
            .as_deref(),
        Some("acceptEdits")
    );
    assert_eq!(
        get_setting(&server, "provider", "claude.skipPermissions").await,
        None
    );
}

#[tokio::test]
async fn provider_put_rejects_invalid_default_mode() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .put(server.http_url("/api/settings/providers/claude"))
        .json(&json!({ "defaultMode": "bogus-mode" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["success"], false);
}

#[tokio::test]
async fn provider_put_rejects_invalid_default_effort() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .put(server.http_url("/api/settings/providers/claude"))
        .json(&json!({ "defaultEffort": "ultra" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["success"], false);
}

// ── providers GET (DB grouping + resolvedExecutable enrichment) ───────────────

#[tokio::test]
async fn provider_get_maps_skip_permissions_to_yolo() {
    let server = spawn_test_server(None).await;
    set_setting(&server, "provider", "claude.skipPermissions", "true").await;
    let body = get_json(&server, "/api/settings/providers").await;
    assert_eq!(body["data"]["claude"]["defaultMode"], "yolo");
    assert!(body["data"]["claude"]["skipPermissions"].is_null());
}

#[tokio::test]
async fn provider_get_includes_adapter_with_only_stored_settings() {
    let server = spawn_test_server(None).await;
    set_setting(&server, "provider", "ghost.defaultModel", "gpt-ghost").await;
    let body = get_json(&server, "/api/settings/providers").await;
    assert_eq!(body["data"]["ghost"]["defaultModel"], "gpt-ghost");
    // resolvedExecutable is attached for every id (TS resolveAdapterExecutableCached).
    // `ghost` is not a real CLI and has no configured path, so it resolves to the
    // bare-name fallback (source "fallback", invalid).
    let resolved = &body["data"]["ghost"]["resolvedExecutable"];
    assert_eq!(resolved["source"], "fallback");
    assert_eq!(resolved["valid"], false);
    assert_eq!(resolved["path"], "ghost");
}

// ── notifications ────────────────────────────────────────────────────────────

#[tokio::test]
async fn notifications_default_when_empty() {
    let server = spawn_test_server(None).await;
    let body = get_json(&server, "/api/settings/general").await;
    assert_eq!(
        body["data"]["notifications"],
        json!(NotificationConfig::default())
    );
}

#[tokio::test]
async fn notifications_stored_merged_with_defaults() {
    let server = spawn_test_server(None).await;
    let stored = json!({
        "chat": { "taskComplete": false, "sessionError": true },
        "permission": { "toolRequest": true, "userQuestion": false, "planApproval": true },
        "other": { "plugin": false },
    })
    .to_string();
    set_setting(&server, "general", "notifications", &stored).await;
    let body = get_json(&server, "/api/settings/general").await;
    assert_eq!(body["data"]["notifications"]["chat"]["taskComplete"], false);
    assert_eq!(
        body["data"]["notifications"]["permission"]["userQuestion"],
        false
    );
    assert_eq!(body["data"]["notifications"]["other"]["plugin"], false);
}

#[tokio::test]
async fn notifications_fallback_on_invalid_json() {
    let server = spawn_test_server(None).await;
    set_setting(&server, "general", "notifications", "not-json").await;
    let body = get_json(&server, "/api/settings/general").await;
    assert_eq!(
        body["data"]["notifications"],
        json!(NotificationConfig::default())
    );
}

#[tokio::test]
async fn notifications_put_persists_partial_patch() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .put(server.http_url("/api/settings/general"))
        .json(&json!({ "notifications": { "chat": { "taskComplete": false, "sessionError": true } } }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let stored = get_setting(&server, "general", "notifications")
        .await
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&stored).unwrap();
    assert_eq!(parsed["chat"]["taskComplete"], false);
    assert_eq!(parsed["chat"]["sessionError"], true);
    let d = NotificationConfig::default();
    assert_eq!(parsed["permission"], json!(d.permission));
    assert_eq!(parsed["other"], json!(d.other));
}

#[tokio::test]
async fn notifications_put_merges_subsequent_patches() {
    let server = spawn_test_server(None).await;
    client()
        .put(server.http_url("/api/settings/general"))
        .json(&json!({ "notifications": { "chat": { "taskComplete": false, "sessionError": true } } }))
        .send()
        .await
        .unwrap();
    client()
        .put(server.http_url("/api/settings/general"))
        .json(&json!({ "notifications": { "other": { "plugin": false } } }))
        .send()
        .await
        .unwrap();
    let stored = get_setting(&server, "general", "notifications")
        .await
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&stored).unwrap();
    assert_eq!(parsed["chat"]["taskComplete"], false);
    assert_eq!(parsed["other"]["plugin"], false);
}

#[tokio::test]
async fn notifications_put_rejects_invalid_payload() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .put(server.http_url("/api/settings/general"))
        .json(&json!({ "notifications": { "chat": { "taskComplete": "yes" } } }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["success"], false);
}
