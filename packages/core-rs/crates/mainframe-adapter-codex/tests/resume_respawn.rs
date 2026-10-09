//! #772 regression: respawning a Codex chat that already finished a turn
//! (an idle exit, a daemon restart) must report only the resumed thread's
//! real id — never the spawn-time placeholder `self.id` mints for every
//! session. A placeholder reported here would make
//! `mainframe_db::chat_segments::record_native_id` see a differing id on a
//! segment that has already run a turn and open a spurious `context_reset`
//! segment plus a false "context reset" divider on every respawn.
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;
mod fork_support;

use common::Recorder;
use fork_support::{options, spawn_options, write_fake_app_server};
use mainframe_adapter_api::AdapterSession;
use mainframe_adapter_codex::CodexSession;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_runtime::ResolvedPath;
use std::sync::Arc;
use tempfile::tempdir;

#[tokio::test]
async fn resuming_a_finished_chat_reports_only_the_real_thread_id() {
    let bin_dir = tempdir().unwrap();
    let capture_path = bin_dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(
        bin_dir.path(),
        &capture_path,
        r#"    thread/resume)
      printf '{"id":%s,"result":{"thread":{"id":"thread-1"},"model":"gpt-5.5"}}\n' "$id"
      ;;
    turn/start)
      printf '{"id":%s,"result":{"turn":{"id":"turn_1","status":"in_progress"}}}\n' "$id"
      ;;"#,
    );
    let project_dir = tempdir().unwrap();

    // `options(Some("thread-1"), None)` mirrors a respawn: the chat already
    // has a stored native thread id and no fork source.
    let session = CodexSession::new(
        mainframe_types::adapter::SessionOptions {
            project_path: project_dir.path().to_str().unwrap().to_string(),
            ..options(Some("thread-1"), None)
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

    // The thread resumes lazily, on the first turn.
    session
        .send_message("hello".to_string(), Vec::new(), None)
        .await
        .expect("send_message succeeds on a resumed chat");

    assert_eq!(
        rec.inits(),
        vec!["thread-1".to_string()],
        "a resume must report exactly the real thread id, with no spawn-time \
         placeholder before it — a placeholder here would make a chat that \
         already ran a turn look like it took a context reset (#772)"
    );
}
