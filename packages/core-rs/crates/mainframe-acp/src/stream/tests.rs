//! Basic delta/seed and lifecycle/gate characterization for
//! `SessionStream`. Retry-marker cases moved to `retry_marker_tests.rs`
//! (todo #350, plan task 37, R2.13) — it shares this file's fixture
//! builders via `use super::*`.

mod retry_marker_tests;

use serde_json::json;

use super::*;
use crate::encoder::ItemRole;
use mainframe_types::acp::tool_call::{ToolCallContent, ToolCallStatus, ToolKind};

fn text_blocks(text: &str) -> Vec<mainframe_types::acp::content::ContentBlock> {
    vec![mainframe_types::acp::content::ContentBlock::Text {
        text: text.to_string(),
        meta: None,
    }]
}

fn message(id: &str, text: &str) -> EncodedItem {
    EncodedItem::Message {
        id: id.to_string(),
        role: ItemRole::Agent,
        content: text_blocks(text),
        meta: None,
    }
}

fn message_with_meta(id: &str, text: &str, meta: Value) -> EncodedItem {
    EncodedItem::Message {
        id: id.to_string(),
        role: ItemRole::Agent,
        content: text_blocks(text),
        meta: Some(meta),
    }
}

fn tool(id: &str, status: ToolCallStatus) -> EncodedItem {
    EncodedItem::ToolCall {
        id: id.to_string(),
        title: "Read".to_string(),
        kind: ToolKind::Read,
        status,
        raw_input: Value::Null,
        content: Vec::<ToolCallContent>::new(),
        meta: None,
    }
}

fn marker() -> RetryMarker {
    RetryMarker {
        attempt: 2,
        reason: Some("overloaded_error".to_string()),
    }
}

/// Interval 0: every push is due, so assertions see frames immediately.
fn stream() -> SessionStream {
    SessionStream::new(0)
}

fn as_update(frame: &ThrottledFrame) -> &SessionUpdate {
    let ThrottledFrame::Update(update) = frame else {
        panic!("expected an Update frame, got {frame:?}");
    };
    update
}

#[test]
fn a_growing_message_creates_once_then_chunks_the_delta() {
    let mut stream = stream();

    let first = stream.on_revision(&[message("m1", "Hel")], 0);
    assert_eq!(first.len(), 1);
    assert!(matches!(
        as_update(&first[0]),
        SessionUpdate::AgentMessage(_)
    ));

    let second = stream.on_revision(&[message("m1", "Hello")], 10);
    assert_eq!(second.len(), 1);
    let SessionUpdate::AgentMessageChunk(chunk) = as_update(&second[0]) else {
        panic!("expected a chunk, got {:?}", second[0]);
    };
    let mainframe_types::acp::content::ContentBlock::Text { text, .. } = &chunk.content else {
        panic!("expected a text delta, got {:?}", chunk.content);
    };
    assert_eq!(text, "lo");
}

#[test]
fn seeding_replayed_items_makes_the_next_revision_a_pure_delta() {
    let mut stream = stream();
    stream.seed(&[message("m1", "Hello")]);

    // The client already received "Hello" via resume replay — only the
    // suffix may go on the wire.
    let updates = stream.on_revision(&[message("m1", "Hello world")], 0);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessageChunk(chunk) = as_update(&updates[0]) else {
        panic!("expected a chunk, got {:?}", updates[0]);
    };
    let mainframe_types::acp::content::ContentBlock::Text { text, .. } = &chunk.content else {
        panic!("expected a text delta, got {:?}", chunk.content);
    };
    assert_eq!(text, " world");
}

#[test]
fn lifecycle_frames_share_the_throttle_fifo_so_idle_never_overtakes_content() {
    // A wide window: the chunk after the opening frame is buffered.
    let mut stream = SessionStream::new(1_000);
    assert_eq!(stream.on_revision(&[message("m1", "Hel")], 0).len(), 1);
    assert!(stream.on_revision(&[message("m1", "Hello")], 10).is_empty());

    // The turn ends inside the window: the Idle frame queues BEHIND the
    // held chunk rather than jumping the socket.
    assert!(stream.on_turn_finished(StopReason::EndTurn, 20).is_empty());
    let drained = stream.flush(30);
    assert_eq!(drained.len(), 2);
    assert!(matches!(
        as_update(&drained[0]),
        SessionUpdate::AgentMessageChunk(_)
    ));
    let SessionUpdate::StateUpdate(WireSessionState::Idle(idle)) = as_update(&drained[1]) else {
        panic!("expected the Idle frame last, got {:?}", drained[1]);
    };
    assert_eq!(idle.stop_reason, Some(StopReason::EndTurn));
}

#[test]
fn turn_started_and_usage_emit_their_wire_frames() {
    let mut stream = stream();

    let started = stream.on_turn_started(0);
    assert_eq!(started.len(), 1);
    assert!(matches!(
        as_update(&started[0]),
        SessionUpdate::StateUpdate(WireSessionState::Running)
    ));

    let usage = stream.on_usage(
        UsageUpdate {
            used: 1_000,
            size: 200_000,
            cost: None,
            meta: None,
        },
        10,
    );
    assert_eq!(usage.len(), 1);
    let SessionUpdate::UsageUpdate(update) = as_update(&usage[0]) else {
        panic!("expected a usage update, got {:?}", usage[0]);
    };
    assert_eq!(update.used, 1_000);
    assert_eq!(update.size, 200_000);
}

#[test]
fn cancelled_and_error_stops_map_to_their_wire_reasons() {
    let mut stream = stream();
    let cancelled = stream.on_turn_finished(StopReason::Cancelled, 0);
    let SessionUpdate::StateUpdate(WireSessionState::Idle(idle)) = as_update(&cancelled[0]) else {
        panic!("expected Idle, got {:?}", cancelled[0]);
    };
    assert_eq!(idle.stop_reason, Some(StopReason::Cancelled));

    let errored = stream.on_turn_finished(StopReason::Error, 10);
    let SessionUpdate::StateUpdate(WireSessionState::Idle(idle)) = as_update(&errored[0]) else {
        panic!("expected Idle, got {:?}", errored[0]);
    };
    assert_eq!(idle.stop_reason, Some(StopReason::Error));
    let wire = serde_json::to_value(as_update(&errored[0])).unwrap();
    assert_eq!(wire["stopReason"], json!("_mainframe.dev/error"));
}

#[test]
fn a_gate_cannot_precede_the_tool_call_it_belongs_to() {
    // A wide window: both the tool-call create and the raw gate frame land
    // inside it, buffered behind the opening frame that already flushed.
    let mut stream = SessionStream::new(1_000);
    assert_eq!(stream.on_revision(&[message("m1", "Hel")], 0).len(), 1);

    let tool_call = EncodedItem::ToolCall {
        id: "tool-1".to_string(),
        title: "Bash".to_string(),
        kind: mainframe_types::acp::tool_call::ToolKind::Execute,
        status: mainframe_types::acp::tool_call::ToolCallStatus::InProgress,
        raw_input: json!({}),
        content: Vec::new(),
        meta: None,
    };
    assert!(
        stream
            .on_revision(&[message("m1", "Hel"), tool_call], 10)
            .is_empty(),
        "still within the throttle window"
    );
    assert!(
        stream
            .push_raw(r#"{"method":"session/request_permission"}"#.to_string(), 10)
            .is_empty(),
        "still within the throttle window"
    );

    let drained = stream.flush(1_020);
    assert_eq!(drained.len(), 2);
    assert!(matches!(
        as_update(&drained[0]),
        SessionUpdate::ToolCallUpdate(_)
    ));
    assert!(matches!(drained[1], ThrottledFrame::Raw(_)));
}
