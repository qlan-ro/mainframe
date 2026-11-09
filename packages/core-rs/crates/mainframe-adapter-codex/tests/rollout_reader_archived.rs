//! `read_rollout_items` containment for a thread archived in Codex: Codex
//! moves the rollout from `sessions/` to the sibling `archived_sessions/`, and
//! that directory is the only other place a rollout may be read from.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

use mainframe_adapter_codex::item_types::ThreadItem;
use mainframe_adapter_codex::rollout_reader::{RolloutReaderDeps, read_rollout_items};
use serde_json::json;
use tempfile::TempDir;

fn message_line(role: &str, text: &str) -> String {
    json!({
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": role,
            "content": [{"type": "output_text", "text": text}],
        }
    })
    .to_string()
}

#[tokio::test]
async fn archived_thread_rollout_is_read_from_the_sibling_archived_sessions_dir() {
    let codex_home = TempDir::new().unwrap();
    let sessions = codex_home.path().join("sessions");
    let archived = codex_home.path().join("archived_sessions");
    std::fs::create_dir_all(&sessions).unwrap();
    std::fs::create_dir_all(&archived).unwrap();
    let path = archived.join("rollout-2026-10-26T23-50-20-thread-arch.jsonl");
    std::fs::write(&path, message_line("assistant", "from the archive")).unwrap();
    let deps = RolloutReaderDeps {
        sessions_root: Some(sessions),
    };

    let items = read_rollout_items(path.to_str().unwrap(), Some("thread-arch"), Some(&deps)).await;

    assert_eq!(items.len(), 1);
    assert!(matches!(&items[0], ThreadItem::AgentMessage(m) if m.text == "from the archive"));
}

#[tokio::test]
async fn rollout_outside_both_codex_session_dirs_is_refused() {
    let codex_home = TempDir::new().unwrap();
    let sessions = codex_home.path().join("sessions");
    let elsewhere = codex_home.path().join("elsewhere");
    std::fs::create_dir_all(&sessions).unwrap();
    std::fs::create_dir_all(&elsewhere).unwrap();
    let path = elsewhere.join("rollout-thread-out.jsonl");
    std::fs::write(&path, message_line("assistant", "should not load")).unwrap();
    let deps = RolloutReaderDeps {
        sessions_root: Some(sessions),
    };

    let items = read_rollout_items(path.to_str().unwrap(), Some("thread-out"), Some(&deps)).await;

    assert!(items.is_empty());
}
