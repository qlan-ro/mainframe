//! Todo #303 — red-phase integration tests for the Codex turn-start model
//! resolution. Written against **today's** API: no reference to `turn_model`,
//! `default_model`, or any other symbol the fix introduces. Drives a real
//! `CodexSession` (spawn + `send_message`) against a fake `codex app-server`
//! that tees every request line it receives to a capture file, so assertions
//! read the exact serialized `turn/start` payload rather than adapter-side
//! structs.
//!
//! `configured_model_is_sent_verbatim_in_collaboration_mode_settings` passes
//! today and is the regression guard for acceptance criterion 1. The other
//! four cases fail today — `CollaborationModeSettings.model` is
//! `Option<String>` with `skip_serializing_if`, so a model-less chat omits the
//! key instead of falling back through the reported/default tiers, and
//! nothing stops a `turn/start` from being sent when no model can be found.
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use common::Recorder;
use mainframe_adapter_api::AdapterSession;
use mainframe_adapter_codex::CodexSession;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::{SessionOptions, SessionSpawnOptions};
use serde_json::Value;
use tempfile::tempdir;

/// Generates a fake `codex app-server` that dispatches on the JSON-RPC
/// `method` of each stdin line (rather than a fixed read count) so the same
/// script drives both today's behavior (a `turn/start` always follows
/// `thread/start`) and the fixed behavior (no `turn/start` when no model
/// resolves) without hanging either way. Every line read is teed verbatim to
/// `capture_path` before it is answered.
///
/// `thread_start_extra` is spliced into the `thread/start`/`thread/resume`
/// result object, e.g. `,"model":"gpt-5.6-sol"` to report a resolved model,
/// or `""` to omit it.
fn fake_app_server_script(capture_path: &Path, thread_start_extra: &str) -> String {
    format!(
        r#"#!/bin/sh
while IFS= read -r line; do
  printf '%s\n' "$line" >> '{capture}'
  method=$(printf '%s' "$line" | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  case "$method" in
    initialize)
      printf '{{"id":%s,"result":{{"userAgent":"codex/0.144.3","codexHome":"/tmp/.codex"}}}}\n' "$id"
      ;;
    initialized)
      ;;
    thread/start|thread/resume)
      printf '{{"id":%s,"result":{{"thread":{{"id":"thread_1"}}{extra}}}}}\n' "$id"
      ;;
    turn/start)
      printf '{{"id":%s,"result":{{"turn":{{"id":"turn_1","status":"in_progress"}}}}}}\n' "$id"
      ;;
  esac
done
"#,
        capture = capture_path.display(),
        extra = thread_start_extra,
    )
}

/// Writes and chmods the fake app-server script, returning its path.
fn write_fake_app_server(
    dir: &Path,
    capture_path: &Path,
    thread_start_extra: &str,
) -> std::path::PathBuf {
    let fake = dir.join("codex");
    fs::write(
        &fake,
        fake_app_server_script(capture_path, thread_start_extra),
    )
    .unwrap();
    let mut perms = fs::metadata(&fake).unwrap().permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&fake, perms).unwrap();
    fake
}

/// The one place the `SessionSpawnOptions` literal is built. Group 2 (todo
/// #303) adds a `default_model` field to that struct — this is the only
/// helper it needs to touch.
fn spawn_options(
    model: Option<&str>,
    plan_mode: Option<bool>,
    executable_path: String,
) -> SessionSpawnOptions {
    SessionSpawnOptions {
        model: model.map(str::to_string),
        permission_mode: None,
        plan_mode,
        executable_path: Some(executable_path),
        system_prompt: None,
        tuning: None,
        small_fast_model: None,
        default_model: None,
    }
}

/// Spawns a `CodexSession` against a fake app-server whose `thread/start`
/// reply carries `thread_start_extra` (e.g. `,"model":"gpt-5.6-sol"` or `""`
/// to omit it). Returns the session (kept alive for `send_message`), a
/// recorder for the sink callbacks, the capture-file path, and the two temp
/// dirs (script + project) whose `Drop` must outlive the assertions — the
/// capture file lives inside the script dir.
async fn spawn_test_session(
    model: Option<&str>,
    plan_mode: Option<bool>,
    thread_start_extra: &str,
) -> (
    CodexSession,
    Recorder,
    std::path::PathBuf,
    tempfile::TempDir,
    tempfile::TempDir,
) {
    let bin_dir = tempdir().unwrap();
    let capture_path = bin_dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(bin_dir.path(), &capture_path, thread_start_extra);

    let project_dir = tempdir().unwrap();
    let session = CodexSession::new(
        SessionOptions {
            project_path: project_dir.path().to_str().unwrap().to_string(),
            chat_id: None,
            mainframe_chat_id: "chat-1".to_string(),
        },
        None,
        ResolvedPath::from_value("/usr/bin:/bin"),
        std::sync::Arc::new(BackgroundTaskTracker::new()),
    );

    let rec = Recorder::new();
    session
        .spawn(
            Some(spawn_options(
                model,
                plan_mode,
                fake.to_str().unwrap().to_string(),
            )),
            Some(rec.sink()),
        )
        .await
        .expect("spawn against the fake app-server succeeds");

    (session, rec, capture_path, bin_dir, project_dir)
}

/// Every captured stdin line, parsed as JSON, in receipt order.
fn captured_requests(capture_path: &Path) -> Vec<Value> {
    let text = fs::read_to_string(capture_path).unwrap_or_default();
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("captured line is valid JSON"))
        .collect()
}

/// The `params` object of the captured `turn/start` request, if one was sent.
fn turn_start_params(capture_path: &Path) -> Option<Value> {
    captured_requests(capture_path)
        .into_iter()
        .find(|v| v["method"] == "turn/start")
        .map(|v| v["params"].clone())
}

#[tokio::test]
async fn configured_model_is_sent_verbatim_in_collaboration_mode_settings() {
    let (session, _rec, capture_path, _bin_dir, _project_dir) =
        spawn_test_session(Some("gpt-5.5"), None, r#","model":"gpt-5.6-sol""#).await;

    session
        .send_message("hello".to_string(), Vec::new(), None)
        .await
        .expect("send_message succeeds when the chat has a configured model");

    let params = turn_start_params(&capture_path).expect("turn/start was sent");
    assert_eq!(
        params["collaborationMode"]["settings"]["model"],
        Value::String("gpt-5.5".to_string())
    );
    assert_eq!(
        params["collaborationMode"]["settings"]["reasoning_effort"],
        Value::Null
    );
    assert_eq!(
        params["collaborationMode"]["settings"]["developer_instructions"],
        Value::Null
    );
    assert_eq!(params["model"], Value::String("gpt-5.5".to_string()));
}

#[tokio::test]
async fn model_less_chat_falls_back_to_the_thread_reported_model() {
    let (session, _rec, capture_path, _bin_dir, _project_dir) =
        spawn_test_session(None, None, r#","model":"gpt-5.6-sol""#).await;

    session
        .send_message("hello".to_string(), Vec::new(), None)
        .await
        .expect("send_message succeeds by falling back to the thread-reported model");

    let params = turn_start_params(&capture_path).expect("turn/start was sent");
    assert_eq!(
        params["collaborationMode"]["settings"]["model"],
        Value::String("gpt-5.6-sol".to_string())
    );
    assert_eq!(
        params["collaborationMode"]["settings"]["reasoning_effort"],
        Value::Null
    );
    assert_eq!(
        params["collaborationMode"]["settings"]["developer_instructions"],
        Value::Null
    );
    assert!(
        params.get("model").is_none(),
        "top-level turn/start model key must stay omitted when the chat has none, got {params:?}"
    );
}

#[tokio::test]
async fn empty_model_is_treated_as_absent() {
    let (session, _rec, capture_path, _bin_dir, _project_dir) =
        spawn_test_session(Some(""), None, r#","model":"gpt-5.6-sol""#).await;

    session
        .send_message("hello".to_string(), Vec::new(), None)
        .await
        .expect("send_message succeeds by treating an empty model id as absent");

    let params = turn_start_params(&capture_path).expect("turn/start was sent");
    assert_eq!(
        params["collaborationMode"]["settings"]["model"],
        Value::String("gpt-5.6-sol".to_string())
    );
    assert_eq!(
        params["collaborationMode"]["settings"]["reasoning_effort"],
        Value::Null
    );
    assert_eq!(
        params["collaborationMode"]["settings"]["developer_instructions"],
        Value::Null
    );
}

#[tokio::test]
async fn plan_mode_survives_on_a_model_less_chat() {
    let (session, _rec, capture_path, _bin_dir, _project_dir) =
        spawn_test_session(None, Some(true), r#","model":"gpt-5.6-sol""#).await;

    session
        .send_message("hello".to_string(), Vec::new(), None)
        .await
        .expect("send_message succeeds on a model-less plan-mode chat");

    let params = turn_start_params(&capture_path).expect("turn/start was sent");
    assert_eq!(
        params["collaborationMode"]["mode"],
        Value::String("plan".to_string())
    );
    let model = params["collaborationMode"]["settings"]["model"]
        .as_str()
        .expect("collaborationMode.settings.model is a non-empty string");
    assert!(!model.is_empty());
    assert_eq!(
        params["collaborationMode"]["settings"]["reasoning_effort"],
        Value::Null
    );
    assert_eq!(
        params["collaborationMode"]["settings"]["developer_instructions"],
        Value::Null
    );
    assert!(
        params.get("model").is_none(),
        "top-level turn/start model key must stay omitted when the chat has none, got {params:?}"
    );
}

#[tokio::test]
async fn no_resolvable_model_fails_the_send_without_starting_a_turn() {
    // thread/start reply omits `model` entirely — no reported-model fallback,
    // and no default hint exists on today's API.
    let (session, _rec, capture_path, _bin_dir, _project_dir) =
        spawn_test_session(None, None, "").await;

    let result = session
        .send_message("hello".to_string(), Vec::new(), None)
        .await;

    let err = result.expect_err("send_message must fail when no tier resolves a model");
    let message = err.to_string();
    assert!(
        message.to_lowercase().contains("model"),
        "error message should name the missing model, got: {message}"
    );

    // Load-bearing: today's raw `-32600 ... missing field 'model'` also
    // contains the word "model", so the error-text assertion alone would pass
    // spuriously. The capture file must show no turn/start request at all.
    let sent_turn_start = captured_requests(&capture_path)
        .iter()
        .any(|v| v["method"] == "turn/start");
    assert!(
        !sent_turn_start,
        "a turn/start request must never be sent when no model resolves"
    );
}
