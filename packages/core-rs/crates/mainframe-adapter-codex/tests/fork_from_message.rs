//! Fork from a message, Codex side: the pin reads the parent thread and pins
//! the turn BEFORE the chosen `userMessage`'s turn; the fork's first spawn
//! sends that id as `thread/fork`'s (inclusive) `lastTurnId`; and the unsent
//! fork's history stops there. Driven against the same fake app-server as
//! `fork.rs`.
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;
mod fork_support;

use std::sync::Arc;

use common::Recorder;
use fork_support::{
    captured_requests, message_texts, options, requests_with_method, spawn_options,
    write_fake_app_server,
};
use mainframe_adapter_api::{Adapter, AdapterSession, ForkCut, ForkPinError, ForkPinRequest};
use mainframe_adapter_codex::{CodexAdapter, CodexSession};
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::SessionOptions;
use serde_json::Value;
use tempfile::tempdir;

/// Three completed turns, each opened by a `userMessage` (`u1`..`u3`) and
/// answered by an `agentMessage` (`ONE`..`THREE`).
const THREE_TURNS: &str = r#"    thread/read)
      printf '{"id":%s,"result":{"thread":{"id":"parent-1","turns":[{"id":"turn-1","status":"completed","items":[{"type":"userMessage","id":"u1","text":"first"},{"type":"agentMessage","id":"a1","text":"ONE"}]},{"id":"turn-2","status":"completed","items":[{"type":"userMessage","id":"u2","text":"second"},{"type":"agentMessage","id":"a2","text":"TWO"}]},{"id":"turn-3","status":"completed","items":[{"type":"userMessage","id":"u3","text":"third"},{"type":"agentMessage","id":"a3","text":"THREE"}]}]}}}\n' "$id"
      ;;
    thread/fork)
      printf '{"id":%s,"result":{"thread":{"id":"fork-1","forkedFromId":"parent-1"},"model":"gpt-5.5"}}\n' "$id"
      ;;
    turn/start)
      printf '{"id":%s,"result":{"turn":{"id":"turn_1","status":"in_progress"}}}\n' "$id"
      ;;"#;

fn adapter_with(fake: &std::path::Path) -> CodexAdapter {
    let adapter = CodexAdapter::new(
        Arc::new(BackgroundTaskTracker::new()),
        ResolvedPath::from_value("/usr/bin:/bin"),
    );
    adapter.set_pin_executable(fake.to_str().unwrap());
    adapter
}

fn cut_request(cwd: &str, dest: &str, vendor_message_id: &str) -> ForkPinRequest {
    ForkPinRequest {
        source_session_id: "parent-1".to_string(),
        cwd: cwd.to_string(),
        session_file_path: None,
        dest_dir: dest.to_string(),
        cut: Some(ForkCut {
            vendor_message_id: vendor_message_id.to_string(),
        }),
    }
}

#[tokio::test]
async fn the_pin_sends_the_earlier_turn_and_the_first_spawn_forks_through_it() {
    let bin_dir = tempdir().unwrap();
    let capture_path = bin_dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(bin_dir.path(), &capture_path, THREE_TURNS);
    let project_dir = tempdir().unwrap();
    let cwd = project_dir.path().to_str().unwrap();
    let snap = bin_dir.path().join("snap");

    let pinned = adapter_with(&fake)
        .pin_fork_point(cut_request(cwd, snap.to_str().unwrap(), "u3"))
        .await
        .expect("pin before the third prompt succeeds");
    assert_eq!(pinned.last_turn_id, Some("turn-2".to_string()));
    assert_eq!(pinned.resume_path, None);

    let session = CodexSession::new(
        SessionOptions {
            project_path: cwd.to_string(),
            ..options(None, Some(pinned))
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
        .expect("spawn succeeds");
    session
        .send_message("third, again".to_string(), Vec::new(), None)
        .await
        .expect("the fork's first send succeeds");

    let reqs = captured_requests(&capture_path);
    let forks = requests_with_method(&reqs, "thread/fork");
    assert_eq!(forks.len(), 1);
    assert_eq!(
        forks[0]["params"]["lastTurnId"],
        Value::String("turn-2".to_string())
    );
    assert!(
        requests_with_method(&reqs, "thread/rollback").is_empty(),
        "a from-message fork must never roll a thread back"
    );
}

#[tokio::test]
async fn the_unsent_forks_history_is_truncated_at_the_earlier_turn() {
    let bin_dir = tempdir().unwrap();
    let capture_path = bin_dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(bin_dir.path(), &capture_path, THREE_TURNS);
    let project_dir = tempdir().unwrap();
    let cwd = project_dir.path().to_str().unwrap();
    let snap = bin_dir.path().join("snap");

    let pinned = adapter_with(&fake)
        .pin_fork_point(cut_request(cwd, snap.to_str().unwrap(), "u2"))
        .await
        .unwrap();
    let session = CodexSession::new(
        options(None, Some(pinned)),
        None,
        ResolvedPath::from_value("/usr/bin:/bin"),
        Arc::new(BackgroundTaskTracker::new()),
    );
    session.set_history_executable(fake.to_str().unwrap());

    let history = session.load_history().await.unwrap();
    assert_eq!(
        message_texts(&history),
        vec!["first".to_string(), "ONE".to_string()],
        "only the turn before the chosen prompt belongs to the fork"
    );
}

#[tokio::test]
async fn a_cut_at_the_first_prompt_or_an_unknown_id_is_point_not_found() {
    let bin_dir = tempdir().unwrap();
    let capture_path = bin_dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(bin_dir.path(), &capture_path, THREE_TURNS);
    let project_dir = tempdir().unwrap();
    let cwd = project_dir.path().to_str().unwrap();
    let snap = bin_dir.path().join("snap");
    let adapter = adapter_with(&fake);

    for id in ["u1", "nope"] {
        let err = adapter
            .pin_fork_point(cut_request(cwd, snap.to_str().unwrap(), id))
            .await
            .unwrap_err();
        assert!(
            matches!(err, ForkPinError::PointNotFound(_)),
            "{id}: {err:?}"
        );
    }
}
