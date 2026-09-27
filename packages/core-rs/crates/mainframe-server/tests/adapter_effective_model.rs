#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use mainframe_adapter_claude::adapter::ClaudeAdapter;
use serde_json::Value;
use std::{os::unix::fs::PermissionsExt, sync::Arc};
use support::spawn_test_server;

#[tokio::test]
async fn resolves_the_configured_executable_in_the_project_directory() {
    let server = spawn_test_server(None).await;
    server
        .ctx
        .adapter_registry
        .register(Arc::new(ClaudeAdapter::default()));
    let dir = tempfile::tempdir().unwrap();
    let exe = dir.path().join("claude-stub");
    std::fs::write(&exe, r#"#!/bin/sh
read -r request
case "$request" in *get_settings*) ;; *) exit 1;; esac
case " $* " in *" --model "*) exit 1;; esac
model=$(cat selected-model)
printf '{"type":"control_response","response":{"request_id":"effective-model","subtype":"success","response":{"applied":{"model":"%s"}}}}\n' "$model"
"#).unwrap();
    std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::write(dir.path().join("selected-model"), "claude-fable-5-1").unwrap();
    let path = dir.path().to_string_lossy().into_owned();
    let executable = exe.to_string_lossy().into_owned();
    let project = server
        .ctx
        .db
        .call(move |db| {
            db.settings
                .set("provider", "claude.executablePath", &executable)?;
            db.projects.create(&path, None)
        })
        .await
        .unwrap();
    let response: Value = reqwest::get(server.http_url(&format!(
        "/api/adapters/claude/effective-model?projectId={}",
        project.id
    )))
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(response["data"], "claude-fable-5-1");
    let missing =
        reqwest::get(server.http_url("/api/adapters/claude/effective-model?projectId=missing"))
            .await
            .unwrap();
    assert_eq!(missing.status(), reqwest::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn stopped_chat_has_no_observed_model() {
    let h = support::facade::spawn_facade_server(Arc::new(ClaudeAdapter::default())).await;
    let dir = tempfile::tempdir().unwrap();
    let exe = dir.path().join("claude-stub");
    std::fs::write(&exe, r#"#!/bin/sh
read -r request
printf '%s\n' '{"type":"control_response","response":{"request_id":"effective-model","subtype":"success","response":{"applied":{"model":"configured-fable"}}}}'
"#).unwrap();
    std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
    let executable = exe.to_string_lossy().into_owned();
    h.server
        .ctx
        .db
        .call(move |db| {
            db.settings
                .set("provider", "claude.executablePath", &executable)
        })
        .await
        .unwrap();
    let response: Value = reqwest::get(h.server.http_url(&format!(
        "/api/adapters/claude/effective-model?chatId={}",
        h.chat_id
    )))
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(response["data"], Value::Null);
}

#[tokio::test]
async fn provider_read_preserves_a_model_missing_from_the_catalog() {
    let server = spawn_test_server(None).await;
    server
        .ctx
        .adapter_registry
        .register(Arc::new(ClaudeAdapter::default()));
    server.ctx.adapter_registry.seed_static_snapshots();
    server
        .ctx
        .db
        .call(|db| {
            db.settings
                .set("provider", "claude.defaultModel", "custom-opus")
        })
        .await
        .unwrap();
    let response: Value = reqwest::get(server.http_url("/api/settings/providers"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(response["data"]["claude"]["defaultModel"], "custom-opus");
}
