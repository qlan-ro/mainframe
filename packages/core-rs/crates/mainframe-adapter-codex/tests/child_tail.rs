//! Covers `child_tail::spawn_child_tail`'s bounded-poll rollout tail: backlog
//! replay, a not-yet-created file, two children tailed concurrently without
//! cross-contamination, cancel-on-complete dropping a late batch, and that a
//! quiet second poll doesn't re-emit the first batch.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::time::Duration;

use common::Recorder;
use mainframe_adapter_codex::child_tail::spawn_child_tail;
use mainframe_adapter_codex::rollout_reader::RolloutReaderDeps;
use mainframe_types::chat::MessageContent;
use mainframe_types::content::LeafContent;
use serde_json::json;
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

// The tail's own poll interval is 300ms; pad past it so a tick has definitely run.
const PAST_ONE_TICK: Duration = Duration::from_millis(400);
const PAST_TWO_TICKS: Duration = Duration::from_millis(700);

fn deps(root: &TempDir) -> RolloutReaderDeps {
    RolloutReaderDeps {
        sessions_root: Some(root.path().to_path_buf()),
    }
}

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

fn write_rollout(root: &TempDir, thread_id: &str, lines: &[String]) -> String {
    let path = root.path().join(format!("rollout-{thread_id}.jsonl"));
    std::fs::write(&path, lines.join("\n")).unwrap();
    path.to_string_lossy().to_string()
}

fn append_rollout(rollout_path: &str, line: &str) {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .append(true)
        .open(rollout_path)
        .unwrap();
    writeln!(f).unwrap();
    write!(f, "{line}").unwrap();
}

fn message_texts(recorder: &Recorder) -> Vec<(String, Option<String>)> {
    recorder
        .messages()
        .into_iter()
        .flat_map(|blocks| {
            blocks.into_iter().filter_map(|b| match b {
                MessageContent::Leaf(LeafContent::Text {
                    text,
                    parent_tool_use_id,
                }) => Some((text, parent_tool_use_id)),
                _ => None,
            })
        })
        .collect()
}

#[tokio::test]
async fn backlog_present_at_spawn_time_is_replayed() {
    let root = tempfile::tempdir().unwrap();
    let path = write_rollout(
        &root,
        "child_1",
        &[
            message_line("assistant", "first"),
            message_line("assistant", "second"),
        ],
    );
    let recorder = Recorder::new();
    let cancel = CancellationToken::new();
    let handle = spawn_child_tail(
        "child_1".to_string(),
        path,
        recorder.sink(),
        "parent_1".to_string(),
        cancel.clone(),
        Some(deps(&root)),
    );
    tokio::time::sleep(PAST_ONE_TICK).await;
    cancel.cancel();
    handle.await.unwrap();

    let texts = message_texts(&recorder);
    assert_eq!(
        texts,
        vec![
            ("first".to_string(), Some("parent_1".to_string())),
            ("second".to_string(), Some("parent_1".to_string())),
        ]
    );
}

#[tokio::test]
async fn file_created_after_spawn_is_picked_up_on_a_later_poll() {
    let root = tempfile::tempdir().unwrap();
    let path = root
        .path()
        .join("rollout-child_2.jsonl")
        .to_string_lossy()
        .to_string();
    let recorder = Recorder::new();
    let cancel = CancellationToken::new();
    let handle = spawn_child_tail(
        "child_2".to_string(),
        path.clone(),
        recorder.sink(),
        "parent_2".to_string(),
        cancel.clone(),
        Some(deps(&root)),
    );

    // First tick(s) find no file — must not panic, must not fabricate items.
    tokio::time::sleep(PAST_ONE_TICK).await;
    assert!(message_texts(&recorder).is_empty());

    std::fs::write(&path, message_line("assistant", "late arrival")).unwrap();
    tokio::time::sleep(PAST_ONE_TICK).await;
    cancel.cancel();
    handle.await.unwrap();

    assert_eq!(
        message_texts(&recorder),
        vec![("late arrival".to_string(), Some("parent_2".to_string()))]
    );
}

#[tokio::test]
async fn two_children_tail_concurrently_without_cross_contamination() {
    let root = tempfile::tempdir().unwrap();
    let path_a = write_rollout(&root, "child_a", &[message_line("assistant", "from a")]);
    let path_b = write_rollout(&root, "child_b", &[message_line("assistant", "from b")]);
    let recorder = Recorder::new();
    let cancel_a = CancellationToken::new();
    let cancel_b = CancellationToken::new();
    let handle_a = spawn_child_tail(
        "child_a".to_string(),
        path_a,
        recorder.sink(),
        "parent_a".to_string(),
        cancel_a.clone(),
        Some(deps(&root)),
    );
    let handle_b = spawn_child_tail(
        "child_b".to_string(),
        path_b,
        recorder.sink(),
        "parent_b".to_string(),
        cancel_b.clone(),
        Some(deps(&root)),
    );

    tokio::time::sleep(PAST_ONE_TICK).await;
    cancel_a.cancel();
    cancel_b.cancel();
    handle_a.await.unwrap();
    handle_b.await.unwrap();

    let mut texts = message_texts(&recorder);
    texts.sort();
    assert_eq!(
        texts,
        vec![
            ("from a".to_string(), Some("parent_a".to_string())),
            ("from b".to_string(), Some("parent_b".to_string())),
        ]
    );
}

#[tokio::test]
async fn cancel_drops_a_batch_appended_after_cancellation_and_joins_cleanly() {
    let root = tempfile::tempdir().unwrap();
    let path = write_rollout(&root, "child_3", &[message_line("assistant", "before")]);
    let recorder = Recorder::new();
    let cancel = CancellationToken::new();
    let handle = spawn_child_tail(
        "child_3".to_string(),
        path.clone(),
        recorder.sink(),
        "parent_3".to_string(),
        cancel.clone(),
        Some(deps(&root)),
    );

    tokio::time::sleep(PAST_ONE_TICK).await;
    assert_eq!(message_texts(&recorder).len(), 1);

    append_rollout(&path, &message_line("assistant", "after cancel"));
    cancel.cancel();
    // A clean `Ok(())` join (not aborted) proves the task observed cancellation
    // and returned on its own, rather than being forcibly torn down.
    tokio::time::timeout(Duration::from_secs(2), handle)
        .await
        .expect("tail task did not exit after cancellation")
        .expect("tail task should join cleanly, not be aborted");

    assert_eq!(
        message_texts(&recorder),
        vec![("before".to_string(), Some("parent_3".to_string()))]
    );
}

#[tokio::test]
async fn a_quiet_second_poll_does_not_re_emit_the_first_batch() {
    let root = tempfile::tempdir().unwrap();
    let path = write_rollout(&root, "child_4", &[message_line("assistant", "only once")]);
    let recorder = Recorder::new();
    let cancel = CancellationToken::new();
    let handle = spawn_child_tail(
        "child_4".to_string(),
        path,
        recorder.sink(),
        "parent_4".to_string(),
        cancel.clone(),
        Some(deps(&root)),
    );

    tokio::time::sleep(PAST_TWO_TICKS).await;
    cancel.cancel();
    handle.await.unwrap();

    assert_eq!(
        message_texts(&recorder),
        vec![("only once".to_string(), Some("parent_4".to_string()))]
    );
}
