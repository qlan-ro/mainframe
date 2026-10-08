//! Drives a real `CodexSession` against a fake `codex app-server` and asserts
//! on the `turn/start` `additionalContext` the orchestration prompt rides in
//! on, present only when the spawn carries `orchestration_mcp`.
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::fs;
use std::os::unix::fs::PermissionsExt;

use common::Recorder;
use mainframe_adapter_api::AdapterSession;
use mainframe_adapter_codex::CodexSession;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::{SessionOptions, SessionSpawnOptions};
use mainframe_types::orchestration::{OrchestrationMcpLaunch, SecretToken};
use serde_json::Value;
use tempfile::TempDir;

/// `__CAPTURE__` is substituted with the case's own capture-file path via
/// `str::replace` (not `format!` — the body is full of JSON braces).
const FAKE_APP_SERVER: &str = r#"#!/bin/sh
IFS= read -r _initialize
printf '{"id":1,"result":{"userAgent":"codex/0.144.3","codexHome":"/tmp/.codex"}}\n'
IFS= read -r _initialized
IFS= read -r _thread_start
printf '{"id":2,"result":{"thread":{"id":"thread-1"}}}\n'
IFS= read -r turn_start
printf '%s\n' "$turn_start" > '__CAPTURE__'
printf '{"id":3,"result":{"turn":{"id":"turn-1","status":"inProgress"}}}\n'
cat >/dev/null
"#;

fn write_fake_codex(dir: &TempDir) -> (std::path::PathBuf, std::path::PathBuf) {
    let fake = dir.path().join("codex");
    let capture = dir.path().join("turn-start.json");
    fs::write(
        &fake,
        FAKE_APP_SERVER.replace("__CAPTURE__", capture.to_str().unwrap()),
    )
    .unwrap();
    let mut perms = fs::metadata(&fake).unwrap().permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&fake, perms).unwrap();
    (fake, capture)
}

/// Spawns a `CodexSession` with (or without) an orchestration launch, sends
/// one message, and returns the parsed `turn/start` `params`.
async fn send_and_capture(
    dir: &TempDir,
    orchestration_mcp: Option<OrchestrationMcpLaunch>,
) -> Value {
    let (fake, capture) = write_fake_codex(dir);

    let session = CodexSession::new(
        SessionOptions {
            project_path: dir.path().to_string_lossy().into_owned(),
            chat_id: None,
            mainframe_chat_id: "chat-1".to_string(),
            session_file_path: None,
            fork_source: None,
        },
        None,
        ResolvedPath::from_value("/usr/bin:/bin"),
        std::sync::Arc::new(BackgroundTaskTracker::new()),
    );

    let recorder = Recorder::new();
    session
        .spawn(
            Some(SessionSpawnOptions {
                model: Some("gpt-5-codex".to_string()),
                permission_mode: None,
                plan_mode: None,
                executable_path: Some(fake.to_string_lossy().into_owned()),
                system_prompt: None,
                tuning: None,
                small_fast_model: None,
                default_model: None,
                no_persistence: None,
                orchestration_mcp,
            }),
            Some(recorder.sink()),
        )
        .await
        .expect("spawn succeeds against the fake app-server");

    session
        .send_message("hello".to_string(), Vec::new(), None)
        .await
        .expect("send_message succeeds");

    let raw = fs::read_to_string(&capture).expect("turn/start was captured");
    let value: Value = serde_json::from_str(raw.trim()).expect("captured line is valid JSON");
    value.get("params").cloned().expect("turn/start has params")
}

fn launch() -> OrchestrationMcpLaunch {
    OrchestrationMcpLaunch {
        url: "http://127.0.0.1:31415/mcp".into(),
        token: SecretToken::new("tok".into()),
    }
}

#[tokio::test]
async fn omits_additional_context_without_an_orchestration_launch() {
    let dir = tempfile::tempdir().unwrap();
    let params = send_and_capture(&dir, None).await;
    assert!(params.get("additionalContext").is_none());
}

#[tokio::test]
async fn carries_the_orchestration_prompt_in_additional_context_when_launched() {
    let dir = tempfile::tempdir().unwrap();
    let params = send_and_capture(&dir, Some(launch())).await;
    let entry = &params["additionalContext"]["mainframe_orchestration"];
    assert_eq!(entry["kind"], "application");
    assert_eq!(
        entry["value"].as_str().unwrap(),
        mainframe_orchestration::ORCHESTRATION_SYSTEM_PROMPT
    );
}
