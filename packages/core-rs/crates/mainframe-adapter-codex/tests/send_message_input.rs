//! Drives a real `CodexSession` against a fake `codex app-server` and asserts on
//! the `turn/start` `input` array it sends — the wiring proof for `user_input.rs`
//! (unit-tested in isolation in `src/user_input.rs`).
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::fs;
use std::os::unix::fs::PermissionsExt;

use common::Recorder;
use mainframe_adapter_api::{AdapterSession, ImageInput};
use mainframe_adapter_codex::CodexSession;
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::{SessionOptions, SessionSpawnOptions};
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

/// Write the fake `codex` script into `dir`, spawn a `CodexSession` against it,
/// send one message, and return the parsed `turn/start` `params` plus the
/// recorder that observed `on_cli_message`.
async fn send_and_capture(
    dir: &TempDir,
    message: &str,
    images: Vec<ImageInput>,
) -> (Value, Recorder) {
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

    let session = CodexSession::new(
        SessionOptions {
            project_path: dir.path().to_string_lossy().into_owned(),
            chat_id: None,
            mainframe_chat_id: "chat-1".to_string(),
        },
        None,
        ResolvedPath::from_value("/usr/bin:/bin"),
    );

    let recorder = Recorder::new();
    session
        .spawn(
            Some(SessionSpawnOptions {
                model: None,
                permission_mode: None,
                plan_mode: None,
                executable_path: Some(fake.to_string_lossy().into_owned()),
                system_prompt: None,
                tuning: None,
                small_fast_model: None,
            }),
            Some(recorder.sink()),
        )
        .await
        .expect("spawn succeeds against the fake app-server");

    session
        .send_message(message.to_string(), images, None)
        .await
        .expect("send_message succeeds");

    let raw = fs::read_to_string(&capture).expect("turn/start was captured");
    let value: Value = serde_json::from_str(raw.trim()).expect("captured line is valid JSON");
    let params = value.get("params").cloned().expect("turn/start has params");
    (params, recorder)
}

fn image(media_type: &str, path: Option<&str>) -> ImageInput {
    ImageInput {
        media_type: media_type.to_string(),
        data: "AAA".to_string(),
        path: path.map(str::to_string),
    }
}

#[tokio::test]
async fn sends_local_image_entries_before_the_text_entry() {
    let dir = tempfile::tempdir().unwrap();
    let attachment = dir.path().join("shot.png");
    fs::write(&attachment, b"fake-image-bytes").unwrap();
    let attachment_path = attachment.to_string_lossy().into_owned();

    let (params, recorder) = send_and_capture(
        &dir,
        "look",
        vec![image("image/png", Some(&attachment_path))],
    )
    .await;

    assert_eq!(
        params.get("input").cloned().unwrap(),
        serde_json::json!([
            { "type": "localImage", "path": attachment_path },
            { "type": "text", "text": "look", "text_elements": [] },
        ])
    );
    assert!(recorder.cli_messages().is_empty());
}

#[tokio::test]
async fn sends_the_same_text_only_input_when_there_are_no_images() {
    let dir = tempfile::tempdir().unwrap();

    let (params, recorder) = send_and_capture(&dir, "hi", vec![]).await;

    assert_eq!(
        params.get("input").cloned().unwrap(),
        serde_json::json!([{ "type": "text", "text": "hi", "text_elements": [] }])
    );
    assert!(recorder.cli_messages().is_empty());
}

#[tokio::test]
async fn an_undeliverable_image_still_sends_and_emits_exactly_one_notice() {
    let dir = tempfile::tempdir().unwrap();

    let (params, recorder) = send_and_capture(&dir, "hi", vec![image("image/png", None)]).await;

    let input = params.get("input").cloned().unwrap();
    let has_local_image = input
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry.get("type").and_then(Value::as_str) == Some("localImage"));
    assert!(!has_local_image);
    assert_eq!(
        recorder.cli_messages(),
        vec!["1 image couldn't be attached (missing file) — the rest of your message was sent."]
    );
}
