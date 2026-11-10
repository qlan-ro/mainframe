#![allow(clippy::unwrap_used, clippy::expect_used, reason = "test assertions")]
mod support;
use serde_json::{Value, json};
use support::spawn_test_server;

#[tokio::test]
async fn idle_setting_get_is_boolean_and_partial_put_preserves_other_keys() {
    let server = spawn_test_server(None).await;
    let url = server.http_url("/api/settings/general");
    let client = reqwest::Client::new();
    let body: Value = client.get(&url).send().await.unwrap().json().await.unwrap();
    assert_eq!(body["data"]["idleCompaction"]["enabled"], false);
    for patch in [
        json!({"worktreeDir":"other","idleCompaction":{"enabled":true}}),
        json!({"updateChannel":"prerelease"}),
    ] {
        assert!(
            client
                .put(&url)
                .json(&patch)
                .send()
                .await
                .unwrap()
                .status()
                .is_success()
        );
    }
    let body: Value = client.get(&url).send().await.unwrap().json().await.unwrap();
    assert_eq!(body["data"]["idleCompaction"]["enabled"], true);
    assert_eq!(body["data"]["worktreeDir"], "other");
    assert!(
        client
            .put(&url)
            .json(&json!({"idleCompaction":{"enabled":false}}))
            .send()
            .await
            .unwrap()
            .status()
            .is_success()
    );
    let body: Value = client.get(&url).send().await.unwrap().json().await.unwrap();
    assert_eq!(body["data"]["idleCompaction"]["enabled"], false);
    assert_eq!(body["data"]["worktreeDir"], "other");
}
#[tokio::test]
async fn invalid_idle_patch_has_existing_error_envelope_and_no_partial_writes() {
    let server = spawn_test_server(None).await;
    let url = server.http_url("/api/settings/general");
    let client = reqwest::Client::new();
    for enabled in [json!("true"), json!(1), json!(null), json!([]), json!({})] {
        let response = client
            .put(&url)
            .json(&json!({"worktreeDir":"changed","idleCompaction":{"enabled":enabled}}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
        let body: Value = response.json().await.unwrap();
        assert_eq!(body["success"], false);
        let body: Value = client.get(&url).send().await.unwrap().json().await.unwrap();
        assert_eq!(body["data"]["worktreeDir"], ".worktrees");
        assert_eq!(body["data"]["idleCompaction"]["enabled"], false);
    }
}
