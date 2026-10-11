//! The handoff marker round trip through each adapter's real history loader:
//! a marker-prefixed first message must read back verbatim (Claude JSONL,
//! Codex rollout and `thread/read`), so composition can split the transcript
//! at it and strip it back to exactly what the user typed. Fixture-based; the
//! live CLI checks are listed in the spec's "Pending live verification".
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;

use mainframe_adapter_codex::history::convert_thread_items;
use mainframe_adapter_codex::item_types::ThreadItem;
use mainframe_adapter_codex::rollout_reader::{RolloutReaderDeps, read_rollout_items};
use mainframe_chat::handoff::render::{HeaderInput, prepend_block, render_block};
use mainframe_chat::handoff::{HandoffItem, ItemKind, leading_marker_segment};
use mainframe_chat::segments::compose::assemble;
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use mainframe_types::content::LeafContent;
use mainframe_types::segment::{
    HandoffStrategy, NativeSessionRecord, SegmentKind, SegmentLayout, SegmentRecord,
};
use serde_json::json;

const TYPED: &str = "Review what Claude built.";

fn sent_text() -> String {
    let header = HeaderInput {
        segment_marker: "seg_b".into(),
        handoff_id: "ho_1".into(),
        strategy: HandoffStrategy::Full,
        title: "Chat".into(),
        chat_id: "chat_1".into(),
        strategy_line: "Earlier turns 1–1 ran in Claude. You have not seen them.".into(),
        recovery_line: None,
    };
    let items = vec![HandoffItem {
        kind: ItemKind::User,
        turn: 1,
        provider: "Claude".into(),
        text: "start".into(),
    }];
    prepend_block(&render_block(&header, &items, 1), TYPED)
}

fn first_user_text(messages: &[ChatMessage]) -> String {
    let user = messages
        .iter()
        .find(|m| m.r#type == ChatMessageType::User)
        .expect("a user message");
    user.content
        .iter()
        .find_map(|b| match b {
            MessageContent::Leaf(LeafContent::Text { text, .. }) => Some(text.clone()),
            _ => None,
        })
        .unwrap()
}

/// Segment `seg_b` (ordinal 1) is the only segment on native `ns_b`, opened
/// by the marker; `seg_a` ran on another native session.
fn layout() -> SegmentLayout {
    let segment = |id: &str, ordinal: u32, native: &str, marker: Option<&str>| SegmentRecord {
        id: id.into(),
        ordinal,
        native_session_ref: native.into(),
        kind: if ordinal == 0 {
            SegmentKind::Initial
        } else {
            SegmentKind::ProviderSwitch
        },
        start_marker: marker.map(str::to_string),
        closed_at: (ordinal == 0).then(|| "t".to_string()),
        ..Default::default()
    };
    let native = |id: &str, adapter: &str| NativeSessionRecord {
        id: id.into(),
        adapter_id: adapter.into(),
        native_session_id: Some(format!("{id}-native")),
        ..Default::default()
    };
    SegmentLayout {
        segments: vec![
            segment("seg_a", 0, "ns_a", None),
            segment("seg_b", 1, "ns_b", Some("seg_b")),
        ],
        natives: vec![native("ns_a", "claude"), native("ns_b", "codex")],
        handoffs: vec![],
    }
}

/// The loaded transcript reads back verbatim, then composes to the typed text.
fn assert_round_trip(loaded: Vec<ChatMessage>) {
    let raw = first_user_text(&loaded);
    assert_eq!(raw, sent_text(), "the loader must keep the marker verbatim");
    assert_eq!(leading_marker_segment(&raw), Some("seg_b"));
    let transcripts = HashMap::from([("ns_b".to_string(), loaded)]);
    let composed = assemble("chat_1", &layout(), transcripts, &|a: &str| a.to_string());
    assert_eq!(composed.messages[0].id, "segdiv-seg_b");
    assert_eq!(first_user_text(&composed.messages), TYPED);
}

async fn claude_load(content: serde_json::Value) -> Vec<ChatMessage> {
    let dir = tempfile::tempdir().unwrap();
    let lines = [
        json!({"type": "user", "uuid": "u-1", "timestamp": "2026-10-06T00:00:00Z", "sessionId": "sess-b",
               "message": {"role": "user", "content": content}}),
        json!({"type": "assistant", "uuid": "a-1", "timestamp": "2026-10-06T00:00:01Z", "sessionId": "sess-b",
               "message": {"id": "msg_1", "role": "assistant", "content": [{"type": "text", "text": "On it."}]}}),
    ];
    let body: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
    std::fs::write(dir.path().join("sess-b.jsonl"), body.join("\n")).unwrap();
    let dir_str = dir.path().to_string_lossy().to_string();
    mainframe_adapter_claude::history::load_history_in_dir("sess-b", &dir_str).await
}

#[tokio::test]
async fn claude_jsonl_string_content_round_trips() {
    assert_round_trip(claude_load(json!(sent_text())).await);
}

#[tokio::test]
async fn claude_jsonl_text_block_content_round_trips() {
    assert_round_trip(claude_load(json!([{"type": "text", "text": sent_text()}])).await);
}

#[tokio::test]
async fn codex_rollout_round_trips() {
    let root = tempfile::tempdir().unwrap();
    let line = |role: &str, kind: &str, text: &str| {
        json!({"type": "response_item", "payload": {"type": "message", "role": role,
               "content": [{"type": kind, "text": text}]}})
        .to_string()
    };
    let lines = [
        line("user", "input_text", &sent_text()),
        line("assistant", "output_text", "On it."),
    ];
    let path = root.path().join("rollout-thread_b.jsonl");
    std::fs::write(&path, lines.join("\n")).unwrap();
    let deps = RolloutReaderDeps {
        sessions_root: Some(root.path().to_path_buf()),
    };
    let items = read_rollout_items(&path.to_string_lossy(), Some("thread_b"), Some(&deps)).await;
    let loaded = convert_thread_items(&items, "thread_b", &HashMap::new(), &HashMap::new());
    assert_round_trip(loaded);
}

#[test]
fn codex_thread_read_round_trips() {
    let items: Vec<ThreadItem> = serde_json::from_value(json!([
        {"id": "m1", "type": "userMessage", "content": [{"type": "text", "text": sent_text()}]},
        {"id": "m2", "type": "agentMessage", "text": "On it."}
    ]))
    .unwrap();
    assert_round_trip(convert_thread_items(
        &items,
        "thread_b",
        &HashMap::new(),
        &HashMap::new(),
    ));
}
