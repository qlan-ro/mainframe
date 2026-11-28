//! A failed history read stays `Ok([])` for the callers that treat it as an
//! empty history, and reports itself through `last_history_read_failed` for
//! the restore of a released chat, which must not install it.
#![cfg(unix)]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

mod fork_support;

use std::sync::Arc;

use fork_support::{options, write_fake_app_server};
use mainframe_adapter_api::AdapterSession;
use mainframe_adapter_codex::CodexSession;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_runtime::ResolvedPath;
use tempfile::tempdir;

fn session(executable: &str) -> CodexSession {
    let session = CodexSession::new(
        options(Some("thread-1"), None),
        None,
        ResolvedPath::from_value("/usr/bin:/bin"),
        Arc::new(BackgroundTaskTracker::new()),
    );
    session.set_history_executable(executable);
    session
}

#[tokio::test]
async fn an_app_server_that_cannot_start_reads_as_a_failed_empty_history() {
    let dir = tempdir().unwrap();
    let missing = dir.path().join("no-such-codex");
    let session = session(missing.to_str().unwrap());

    let history = session.load_history().await.unwrap();

    assert!(
        history.is_empty(),
        "other callers still see an empty history"
    );
    assert!(session.last_history_read_failed());
}

#[tokio::test]
async fn a_failed_thread_read_reads_as_a_failed_empty_history() {
    let dir = tempdir().unwrap();
    let capture = dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(
        dir.path(),
        &capture,
        r#"    thread/read)
      printf '{"id":%s,"error":{"code":-32603,"message":"read failed"}}\n' "$id"
      ;;"#,
    );
    let session = session(fake.to_str().unwrap());

    let history = session.load_history().await.unwrap();

    assert!(history.is_empty());
    assert!(session.last_history_read_failed());
}

#[tokio::test]
async fn an_empty_thread_read_successfully_is_not_a_failure_and_clears_one() {
    let dir = tempdir().unwrap();
    let capture = dir.path().join("capture.jsonl");
    let empty = write_fake_app_server(
        dir.path(),
        &capture,
        r#"    thread/read)
      printf '{"id":%s,"result":{"thread":{"id":"thread-1","turns":[]}}}\n' "$id"
      ;;"#,
    );
    let missing = dir.path().join("no-such-codex");
    let session = session(missing.to_str().unwrap());
    session.load_history().await.unwrap();
    assert!(session.last_history_read_failed());

    session.set_history_executable(empty.to_str().unwrap());
    let history = session.load_history().await.unwrap();

    assert!(history.is_empty());
    assert!(
        !session.last_history_read_failed(),
        "a successful read clears the last failure"
    );
}
