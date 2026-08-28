//! Event shapes mirror the 2026-08-28 live capture (CLI 2.1.224, probe run
//! documented in the module doc): wrapper uuids are random per event, the
//! anchor is `message_start`'s `message.id`, and deltas carry `text` /
//! `thinking` per kind.

use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use mainframe_adapter_api::{AdapterError, SessionSink};
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::{
    ContextUsage, ControlRequest, DetectedPr, MessageMetadata, SessionOptions, SessionResult,
};
use mainframe_types::chat::{MessageContent, TodoItem};
use mainframe_types::content::LeafContent;
use mainframe_types::context::SkillFileEntry;

use super::*;

#[derive(Default)]
struct PartialRec {
    calls: Mutex<Vec<(String, Vec<MessageContent>)>>,
}

impl SessionSink for PartialRec {
    fn on_init(&self, _session_id: &str) {}
    fn on_message(&self, _content: Vec<MessageContent>, _metadata: Option<MessageMetadata>) {}
    fn on_tool_result(&self, _content: Vec<MessageContent>, _vendor_id: Option<String>) {}
    fn on_permission(&self, _request: ControlRequest) {}
    fn on_result(&self, _data: SessionResult) {}
    fn on_exit(&self, _code: Option<i32>) {}
    fn on_error(&self, _error: AdapterError) {}
    fn on_compact(&self) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<TodoItem>) {}
    fn on_pr_detected(&self, _pr: DetectedPr) {}
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: mainframe_adapter_api::LoadedSkill) {}
    fn on_subagent_child(&self, _parent_tool_use_id: &str, _blocks: Vec<MessageContent>) {}
    fn on_message_partial(&self, api_message_id: &str, content: Vec<MessageContent>) {
        self.calls
            .lock()
            .unwrap()
            .push((api_message_id.to_string(), content));
    }
}

fn session() -> Arc<ClaudeSession> {
    let s = Arc::new(ClaudeSession::new(
        SessionOptions {
            project_path: "/tmp".to_string(),
            chat_id: None,
            mainframe_chat_id: "test-chat".to_string(),
        },
        None,
        Arc::new(BackgroundTaskTracker::new()),
        Arc::new(ClaudeWorkflowStore::new()),
        ResolvedPath::from_value("/usr/bin:/bin"),
    ));
    s.init_weak();
    // Tests drive deltas back-to-back; a real interval would gate them.
    s.state.lock().unwrap().partial.emit_interval_ms = 0;
    s
}

fn wrap(inner: Value) -> Value {
    json!({
        "type": "stream_event",
        "event": inner,
        "session_id": "sess-1",
        "parent_tool_use_id": null,
        "uuid": "random-wrapper-uuid"
    })
}

fn message_start(id: &str) -> Value {
    wrap(
        json!({ "type": "message_start", "message": { "id": id, "role": "assistant", "content": [] } }),
    )
}

fn block_start(index: u64, kind: &str) -> Value {
    let block = match kind {
        "text" => json!({ "type": "text", "text": "" }),
        "thinking" => json!({ "type": "thinking", "thinking": "", "signature": "" }),
        other => json!({ "type": other }),
    };
    wrap(json!({ "type": "content_block_start", "index": index, "content_block": block }))
}

fn text_delta(index: u64, text: &str) -> Value {
    wrap(
        json!({ "type": "content_block_delta", "index": index, "delta": { "type": "text_delta", "text": text } }),
    )
}

fn thinking_delta(index: u64, thinking: &str) -> Value {
    wrap(
        json!({ "type": "content_block_delta", "index": index, "delta": { "type": "thinking_delta", "thinking": thinking, "estimated_tokens": 1 } }),
    )
}

fn calls(sink: &PartialRec) -> Vec<(String, Vec<MessageContent>)> {
    sink.calls.lock().unwrap().clone()
}

#[test]
fn text_deltas_emit_the_accumulated_block_under_the_api_message_id() {
    let s = session();
    let sink = PartialRec::default();
    handle_stream_event(&s, &message_start("msg_1"), &sink);
    handle_stream_event(&s, &block_start(0, "text"), &sink);
    handle_stream_event(&s, &text_delta(0, "Rivers are "), &sink);
    handle_stream_event(&s, &text_delta(0, "flowing"), &sink);

    let calls = calls(&sink);
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].0, "msg_1");
    assert_eq!(
        calls[1].1,
        vec![MessageContent::Leaf(LeafContent::Text {
            text: "Rivers are flowing".to_string(),
            parent_tool_use_id: None,
        })]
    );
}

#[test]
fn thinking_deltas_emit_thinking_leaves_and_empty_accumulation_stays_silent() {
    let s = session();
    let sink = PartialRec::default();
    handle_stream_event(&s, &message_start("msg_1"), &sink);
    handle_stream_event(&s, &block_start(0, "thinking"), &sink);
    // Hidden-thinking models stream empty prose (live capture: haiku).
    handle_stream_event(&s, &thinking_delta(0, ""), &sink);
    assert!(calls(&sink).is_empty());
    handle_stream_event(&s, &thinking_delta(0, "The user wants"), &sink);

    let calls = calls(&sink);
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].1,
        vec![MessageContent::Leaf(LeafContent::Thinking {
            thinking: "The user wants".to_string(),
            parent_tool_use_id: None,
        })]
    );
}

#[test]
fn signature_and_tool_input_deltas_are_ignored() {
    let s = session();
    let sink = PartialRec::default();
    handle_stream_event(&s, &message_start("msg_1"), &sink);
    handle_stream_event(&s, &block_start(0, "thinking"), &sink);
    handle_stream_event(
        &s,
        &wrap(
            json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "signature_delta", "signature": "sig" } }),
        ),
        &sink,
    );
    handle_stream_event(&s, &block_start(1, "tool_use"), &sink);
    handle_stream_event(
        &s,
        &wrap(
            json!({ "type": "content_block_delta", "index": 1, "delta": { "type": "input_json_delta", "partial_json": "{\"cmd\"" } }),
        ),
        &sink,
    );
    assert!(calls(&sink).is_empty());
}

#[test]
fn a_new_block_restarts_accumulation_under_the_same_message() {
    let s = session();
    let sink = PartialRec::default();
    handle_stream_event(&s, &message_start("msg_1"), &sink);
    handle_stream_event(&s, &block_start(0, "text"), &sink);
    handle_stream_event(&s, &text_delta(0, "first block"), &sink);
    handle_stream_event(
        &s,
        &wrap(json!({ "type": "content_block_stop", "index": 0 })),
        &sink,
    );
    handle_stream_event(&s, &block_start(1, "text"), &sink);
    handle_stream_event(&s, &text_delta(1, "second"), &sink);

    let calls = calls(&sink);
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[1].0, "msg_1");
    assert_eq!(
        calls[1].1,
        vec![MessageContent::Leaf(LeafContent::Text {
            text: "second".to_string(),
            parent_tool_use_id: None,
        })]
    );
}

#[test]
fn message_stop_and_missing_anchor_suppress_emission() {
    let s = session();
    let sink = PartialRec::default();
    // Delta with no prior message_start: no anchor, no call.
    handle_stream_event(&s, &block_start(0, "text"), &sink);
    handle_stream_event(&s, &text_delta(0, "orphan"), &sink);
    assert!(calls(&sink).is_empty());

    handle_stream_event(&s, &message_start("msg_1"), &sink);
    handle_stream_event(&s, &wrap(json!({ "type": "message_stop" })), &sink);
    assert!(s.state.lock().unwrap().partial.api_message_id.is_none());
}

#[test]
fn subagent_stream_events_are_skipped() {
    let s = session();
    let sink = PartialRec::default();
    let mut event = message_start("msg_sub");
    event["parent_tool_use_id"] = json!("toolu_parent");
    handle_stream_event(&s, &event, &sink);
    assert!(s.state.lock().unwrap().partial.api_message_id.is_none());
}

#[test]
fn the_emission_gate_holds_between_intervals_and_reopens() {
    let s = session();
    let sink = PartialRec::default();
    s.state.lock().unwrap().partial.emit_interval_ms = 60_000;
    handle_stream_event(&s, &message_start("msg_1"), &sink);
    handle_stream_event(&s, &block_start(0, "text"), &sink);
    handle_stream_event(&s, &text_delta(0, "a"), &sink);
    handle_stream_event(&s, &text_delta(0, "b"), &sink);
    // First delta emits (no prior emission); second sits inside the window.
    assert_eq!(calls(&sink).len(), 1);
    // The suppressed delta is not lost — it accumulated.
    assert_eq!(
        s.state.lock().unwrap().partial.block.as_ref().unwrap().text,
        "ab"
    );
}

#[test]
fn emit_due_is_a_pure_window_check() {
    assert!(emit_due(None, 50, 0));
    assert!(!emit_due(Some(100), 50, 120));
    assert!(emit_due(Some(100), 50, 150));
    assert!(emit_due(Some(100), 0, 100));
}

#[test]
fn version_at_least_parses_triples() {
    assert!(version_at_least("1.0.109", PARTIAL_MESSAGES_MIN_VERSION));
    assert!(version_at_least("2.1.224", PARTIAL_MESSAGES_MIN_VERSION));
    assert!(!version_at_least("1.0.108", PARTIAL_MESSAGES_MIN_VERSION));
    assert!(!version_at_least("0.2.75", PARTIAL_MESSAGES_MIN_VERSION));
    assert!(!version_at_least("garbage", PARTIAL_MESSAGES_MIN_VERSION));
}
