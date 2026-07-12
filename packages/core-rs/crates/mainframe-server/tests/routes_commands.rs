//! Integration test for `routes/commands.rs` — translated from `commands.test.ts`.
//! The TS asserts an adapter command ('clear' from claude); that union is a
//! Phase-4/5 seam (AdapterRegistry absent from AppCtx), so this asserts the
//! built-in mainframe command from the services registry is returned.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::StatusCode;
use support::spawn_test_server;

#[tokio::test]
async fn returns_mainframe_commands() {
    let server = spawn_test_server(None).await;
    let resp = reqwest::get(server.http_url("/api/commands"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["success"], true);
    let names: Vec<&str> = body["data"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|c| c["name"].as_str())
        .collect();
    assert!(
        names.contains(&"launch-config"),
        "expected the built-in launch-config command, got {names:?}"
    );
    // Every built-in command is sourced 'mainframe'.
    for cmd in body["data"].as_array().unwrap() {
        assert_eq!(cmd["source"], "mainframe");
    }
}
