//! Todo #368 — integration tests for the Codex adapter's `thread/fork` wiring,
//! driven against a fake `codex app-server` (the `tests/turn_start_model.rs`
//! pattern: a shell script dispatching on JSON-RPC `method`, teeing every
//! request line to a capture file). Covers task 3's four scenarios:
//! successful fork, a parent the fake server never "loaded" first, history
//! truncation on both sides of a fork, and the version-gated capability.
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use common::Recorder;
use mainframe_adapter_api::{Adapter, AdapterSession, ForkPinRequest};
use mainframe_adapter_codex::{CodexAdapter, CodexSession};
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::{ForkSource, SessionOptions, SessionSpawnOptions};
use mainframe_types::chat::MessageContent;
use mainframe_types::content::LeafContent;
use serde_json::Value;
use std::sync::Arc;
use tempfile::tempdir;

fn options(chat_id: Option<&str>, fork_source: Option<ForkSource>) -> SessionOptions {
    SessionOptions {
        // A real, existing directory — `load_history`'s temp-app-server spawn
        // sets this as the child's cwd, which fails outright on a path that
        // doesn't exist (unlike an unresolvable executable, which fails the
        // same way but is the thing each test actually means to control).
        project_path: std::env::temp_dir().to_string_lossy().into_owned(),
        chat_id: chat_id.map(str::to_string),
        mainframe_chat_id: "chat-mf368".to_string(),
        session_file_path: None,
        fork_source,
    }
}

fn spawn_options(executable_path: String) -> SessionSpawnOptions {
    SessionSpawnOptions {
        model: Some("gpt-5.5".to_string()),
        permission_mode: None,
        plan_mode: None,
        executable_path: Some(executable_path),
        system_prompt: None,
        tuning: None,
        small_fast_model: None,
        default_model: None,
        no_persistence: None,
    }
}

/// Writes an executable `codex` fake app-server to `dir/codex`, teeing every
/// stdin line to `capture_path` and dispatching `$method_cases` (a raw shell
/// `case` body) by JSON-RPC method. Named literally `codex` so it doubles as
/// both a `SessionSpawnOptions.executable_path` (spawn's explicit override)
/// and, via `ResolvedPath::from_value(dir)`, the `"codex"` PATH lookup
/// `load_history`'s and `pin_fork_point`'s hardcoded temp-app-server spawns
/// use — neither takes an executable override.
fn write_fake_app_server(
    dir: &Path,
    capture_path: &Path,
    method_cases: &str,
) -> std::path::PathBuf {
    let script = format!(
        r#"#!/bin/sh
while IFS= read -r line; do
  printf '%s\n' "$line" >> '{capture}'
  method=$(printf '%s' "$line" | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  case "$method" in
    initialize)
      printf '{{"id":%s,"result":{{"userAgent":"codex/0.155.1","codexHome":"/tmp/.codex"}}}}\n' "$id"
      ;;
    initialized) ;;
{cases}
  esac
done
"#,
        capture = capture_path.display(),
        cases = method_cases,
    );
    let fake = dir.join("codex");
    fs::write(&fake, script).unwrap();
    let mut perms = fs::metadata(&fake).unwrap().permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&fake, perms).unwrap();
    fake
}

fn captured_requests(capture_path: &Path) -> Vec<Value> {
    let text = fs::read_to_string(capture_path).unwrap_or_default();
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("captured line is valid JSON"))
        .collect()
}

fn requests_with_method<'a>(reqs: &'a [Value], method: &str) -> Vec<&'a Value> {
    reqs.iter().filter(|v| v["method"] == method).collect()
}

fn message_texts(messages: &[mainframe_types::chat::ChatMessage]) -> Vec<String> {
    messages
        .iter()
        .flat_map(|m| m.content.iter())
        .filter_map(|c| match c {
            MessageContent::Leaf(LeafContent::Text { text, .. }) => Some(text.clone()),
            _ => None,
        })
        .collect()
}

// ---- Successful fork (task 3, bullet 1) ----

#[tokio::test]
async fn a_forks_first_message_sends_thread_fork_and_the_new_id_flows_through() {
    let bin_dir = tempdir().unwrap();
    let capture_path = bin_dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(
        bin_dir.path(),
        &capture_path,
        r#"    thread/fork)
      printf '{"id":%s,"result":{"thread":{"id":"fork-1","forkedFromId":"parent-1"},"model":"gpt-5.5"}}\n' "$id"
      ;;
    turn/start)
      printf '{"id":%s,"result":{"turn":{"id":"turn_1","status":"in_progress"}}}\n' "$id"
      ;;"#,
    );
    let project_dir = tempdir().unwrap();

    let session = CodexSession::new(
        SessionOptions {
            project_path: project_dir.path().to_str().unwrap().to_string(),
            ..options(
                None,
                Some(ForkSource {
                    source_session_id: "parent-1".to_string(),
                    resume_path: None,
                    last_turn_id: Some("turn-9".to_string()),
                }),
            )
        },
        None,
        ResolvedPath::from_value("/usr/bin:/bin"),
        Arc::new(BackgroundTaskTracker::new()),
    );
    let rec = Recorder::new();
    session
        .spawn(
            Some(spawn_options(fake.to_str().unwrap().to_string())),
            Some(rec.sink()),
        )
        .await
        .expect("spawn against the fake app-server succeeds");

    session
        .send_message("hello".to_string(), Vec::new(), None)
        .await
        .expect("send_message succeeds on a fork's first message");

    let reqs = captured_requests(&capture_path);
    let forks = requests_with_method(&reqs, "thread/fork");
    assert_eq!(
        forks.len(),
        1,
        "expected exactly one thread/fork call, got {reqs:?}"
    );
    let params = &forks[0]["params"];
    assert_eq!(params["threadId"], Value::String("parent-1".to_string()));
    assert_eq!(params["lastTurnId"], Value::String("turn-9".to_string()));
    assert_eq!(params["persistExtendedHistory"], Value::Bool(true));
    assert_eq!(params["persistFullHistory"], Value::Bool(true));
    for key in ["cwd", "model", "sandbox", "approvalPolicy"] {
        assert!(
            params.get(key).is_none(),
            "fork params must omit override key {key}, got {params:?}"
        );
    }
    assert!(
        requests_with_method(&reqs, "thread/resume").is_empty(),
        "a fork's first spawn must never call thread/resume"
    );

    assert_eq!(
        rec.inits().last(),
        Some(&"fork-1".to_string()),
        "the fork's real thread id must be the last on_init (spawn() fires an \
         ephemeral one first for every session, forked or not)"
    );

    let turn_starts = requests_with_method(&reqs, "turn/start");
    assert_eq!(
        turn_starts[0]["params"]["threadId"],
        Value::String("fork-1".to_string())
    );
}

// ---- Parent not loaded: pin and fork both resolve purely by id ----

#[tokio::test]
async fn pin_and_fork_both_succeed_against_a_server_that_never_resumed_the_parent() {
    let bin_dir = tempdir().unwrap();
    let capture_path = bin_dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(
        bin_dir.path(),
        &capture_path,
        r#"    thread/read)
      printf '{"id":%s,"result":{"thread":{"id":"parent-1","turns":[{"id":"turn-1","status":"completed","items":[]}]}}}\n' "$id"
      ;;
    thread/fork)
      printf '{"id":%s,"result":{"thread":{"id":"fork-2","forkedFromId":"parent-1"},"model":"gpt-5.5"}}\n' "$id"
      ;;
    turn/start)
      printf '{"id":%s,"result":{"turn":{"id":"turn_1","status":"in_progress"}}}\n' "$id"
      ;;"#,
    );
    let project_dir = tempdir().unwrap();
    let resolved_path = ResolvedPath::from_value("/usr/bin:/bin");

    // Pin: a brand-new temp app-server (spawned fresh by pin_fork_point) reads
    // the parent purely by id — it was never started or resumed anywhere.
    let adapter = CodexAdapter::new(
        Arc::new(BackgroundTaskTracker::new()),
        resolved_path.clone(),
    );
    adapter.set_pin_executable(fake.to_str().unwrap());
    let pinned = adapter
        .pin_fork_point(ForkPinRequest {
            source_session_id: "parent-1".to_string(),
            cwd: project_dir.path().to_str().unwrap().to_string(),
            session_file_path: None,
            dest_dir: bin_dir.path().join("snap").to_str().unwrap().to_string(),
        })
        .await
        .expect("pin succeeds against a server that never loaded the parent");
    assert_eq!(pinned.source_session_id, "parent-1");
    assert_eq!(pinned.last_turn_id, Some("turn-1".to_string()));
    assert_eq!(pinned.resume_path, None);

    // Fork: a second, independent process forks the same parent id — again,
    // no prior thread/start or thread/resume anywhere for it.
    let session = CodexSession::new(
        SessionOptions {
            project_path: project_dir.path().to_str().unwrap().to_string(),
            ..options(None, Some(pinned))
        },
        None,
        resolved_path,
        Arc::new(BackgroundTaskTracker::new()),
    );
    let rec = Recorder::new();
    session
        .spawn(
            Some(spawn_options(fake.to_str().unwrap().to_string())),
            Some(rec.sink()),
        )
        .await
        .expect("spawn succeeds");
    session
        .send_message("hello".to_string(), Vec::new(), None)
        .await
        .expect("send_message forks successfully");
    assert_eq!(rec.inits().last(), Some(&"fork-2".to_string()));

    let reqs = captured_requests(&capture_path);
    assert!(
        requests_with_method(&reqs, "thread/resume").is_empty(),
        "neither pin nor fork should ever call thread/resume"
    );
}

// ---- History: unsent fork reads the source, truncated; a sent fork reads its own once ----

#[tokio::test]
async fn an_unsent_forks_history_reads_the_source_thread_truncated_at_the_pinned_turn() {
    let bin_dir = tempdir().unwrap();
    let capture_path = bin_dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(
        bin_dir.path(),
        &capture_path,
        r#"    thread/read)
      printf '{"id":%s,"result":{"thread":{"id":"parent-1","turns":[{"id":"turn-1","status":"completed","items":[{"type":"agentMessage","id":"msg-1","text":"ONE"}]},{"id":"turn-2","status":"completed","items":[{"type":"agentMessage","id":"msg-2","text":"TWO"}]}]}}}\n' "$id"
      ;;"#,
    );

    let session = CodexSession::new(
        options(
            None,
            Some(ForkSource {
                source_session_id: "parent-1".to_string(),
                resume_path: None,
                last_turn_id: Some("turn-1".to_string()),
            }),
        ),
        None,
        ResolvedPath::from_value("/usr/bin:/bin"),
        Arc::new(BackgroundTaskTracker::new()),
    );
    session.set_history_executable(fake.to_str().unwrap());

    let history = session
        .load_history()
        .await
        .expect("load_history succeeds against the fake app-server");
    assert_eq!(
        message_texts(&history),
        vec!["ONE".to_string()],
        "the second (post-cap) turn must not appear in an unsent fork's history"
    );

    let reqs = captured_requests(&capture_path);
    let reads = requests_with_method(&reqs, "thread/read");
    assert_eq!(reads.len(), 1);
    assert_eq!(
        reads[0]["params"]["threadId"],
        Value::String("parent-1".to_string()),
        "an unsent fork must read the *source* thread, not its own (absent) id"
    );
}

#[tokio::test]
async fn a_sent_forks_history_reads_only_its_own_thread_once() {
    let bin_dir = tempdir().unwrap();
    let capture_path = bin_dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(
        bin_dir.path(),
        &capture_path,
        r#"    thread/read)
      if printf '%s' "$line" | grep -q '"threadId":"parent-1"'; then
        printf '{"id":%s,"error":{"code":-32600,"message":"must never read the parent once the fork has sent"}}\n' "$id"
      else
        printf '{"id":%s,"result":{"thread":{"id":"own-1","turns":[{"id":"turn-5","status":"completed","items":[{"type":"agentMessage","id":"msg-5","text":"OWN"}]}]}}}\n' "$id"
      fi
      ;;"#,
    );

    let session = CodexSession::new(
        options(
            Some("own-1"),
            Some(ForkSource {
                source_session_id: "parent-1".to_string(),
                resume_path: None,
                last_turn_id: Some("turn-1".to_string()),
            }),
        ),
        None,
        ResolvedPath::from_value("/usr/bin:/bin"),
        Arc::new(BackgroundTaskTracker::new()),
    );
    session.set_transcript_present_override(true);
    session.set_history_executable(fake.to_str().unwrap());

    let history = session
        .load_history()
        .await
        .expect("load_history succeeds by reading its own thread");
    assert_eq!(message_texts(&history), vec!["OWN".to_string()]);

    let reqs = captured_requests(&capture_path);
    let reads = requests_with_method(&reqs, "thread/read");
    assert_eq!(
        reads.len(),
        1,
        "a sent fork must read its own thread exactly once, with no source read"
    );
    assert_eq!(
        reads[0]["params"]["threadId"],
        Value::String("own-1".to_string())
    );
}

// ---- Capability: version-gated fork ----

#[test]
fn capabilities_fork_is_gated_on_the_observed_cli_version() {
    let adapter = CodexAdapter::default();
    assert!(!adapter.capabilities().fork, "no version observed yet");
    assert_eq!(adapter.fork_unavailable_reason(), None);

    adapter.observe_cli_version(Some("0.142.9"));
    assert!(!adapter.capabilities().fork);
    assert_eq!(
        adapter.fork_unavailable_reason(),
        Some(
            "Forking Codex chats needs Codex CLI 0.143.0 or newer (installed: 0.142.9)".to_string()
        )
    );

    adapter.observe_cli_version(Some("0.143.0"));
    assert!(adapter.capabilities().fork);
    assert_eq!(adapter.fork_unavailable_reason(), None);
}
