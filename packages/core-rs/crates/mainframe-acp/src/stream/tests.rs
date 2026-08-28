use serde_json::json;

use super::*;
use crate::encoder::ItemRole;

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

#[test]
fn a_growing_message_creates_once_then_chunks_the_delta() {
    let mut stream = stream();

    let first = stream.on_revision(&[message("m1", "Hel")], 0);
    assert_eq!(first.len(), 1);
    assert!(matches!(first[0], SessionUpdate::AgentMessage(_)));

    let second = stream.on_revision(&[message("m1", "Hello")], 10);
    assert_eq!(second.len(), 1);
    let SessionUpdate::AgentMessageChunk(chunk) = &second[0] else {
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
    let SessionUpdate::AgentMessageChunk(chunk) = &updates[0] else {
        panic!("expected a chunk, got {:?}", updates[0]);
    };
    let mainframe_types::acp::content::ContentBlock::Text { text, .. } = &chunk.content else {
        panic!("expected a text delta, got {:?}", chunk.content);
    };
    assert_eq!(text, " world");
}

#[test]
fn a_retry_marker_rides_the_next_upsert_meta_and_is_consumed_once() {
    let mut stream = stream();
    stream.on_retry(marker());

    let updates = stream.on_revision(&[message("m1", "Retried and completed.")], 0);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessage(upsert) = &updates[0] else {
        panic!("expected an upsert, got {:?}", updates[0]);
    };
    let meta = upsert.meta.clone().flatten().expect("marker meta expected");
    assert_eq!(
        meta[MAINFRAME_META_NAMESPACE],
        json!({ "attempt": 2, "reason": "overloaded_error" })
    );

    // Consumed: the next revision carries no marker.
    let next = stream.on_revision(&[message("m1", "Retried and completed. More")], 10);
    let SessionUpdate::AgentMessageChunk(chunk) = &next[0] else {
        panic!("expected a chunk, got {:?}", next[0]);
    };
    assert_eq!(chunk.meta, None);
}

#[test]
fn a_retry_marker_extends_the_namespace_without_clobbering_the_parent_relation() {
    let mut stream = stream();
    stream.on_retry(marker());

    let updates = stream.on_revision(
        &[message_with_meta(
            "m1",
            "content",
            json!({ MAINFRAME_META_NAMESPACE: { "parentToolCallId": "tool-9" } }),
        )],
        0,
    );
    let SessionUpdate::AgentMessage(upsert) = &updates[0] else {
        panic!("expected an upsert, got {:?}", updates[0]);
    };
    let meta = upsert.meta.clone().flatten().expect("meta expected");
    assert_eq!(
        meta[MAINFRAME_META_NAMESPACE]["parentToolCallId"],
        json!("tool-9")
    );
    assert_eq!(meta[MAINFRAME_META_NAMESPACE]["attempt"], json!(2));
}

#[test]
fn a_marker_with_no_carrier_waits_and_turn_end_clears_it() {
    let mut stream = stream();
    let _ = stream.on_revision(&[message("m1", "Hel")], 0);

    // A pure append is a chunk — no carrier, marker stays pending.
    stream.on_retry(marker());
    let chunk_only = stream.on_revision(&[message("m1", "Hello")], 10);
    assert!(matches!(chunk_only[0], SessionUpdate::AgentMessageChunk(_)));

    // The turn ends before any upsert appears: the marker must not survive
    // into the next turn's unrelated revision.
    let _ = stream.on_turn_finished(StopReason::EndTurn, 20);
    let next_turn = stream.on_revision(&[message("m2", "fresh")], 30);
    let SessionUpdate::AgentMessage(upsert) = &next_turn[0] else {
        panic!("expected an upsert, got {:?}", next_turn[0]);
    };
    assert_eq!(upsert.meta, None);
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
    assert!(matches!(drained[0], SessionUpdate::AgentMessageChunk(_)));
    let SessionUpdate::StateUpdate(WireSessionState::Idle(idle)) = &drained[1] else {
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
        started[0],
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
    let SessionUpdate::UsageUpdate(update) = &usage[0] else {
        panic!("expected a usage update, got {:?}", usage[0]);
    };
    assert_eq!(update.used, 1_000);
    assert_eq!(update.size, 200_000);
}

#[test]
fn cancelled_and_error_stops_map_to_their_wire_reasons() {
    let mut stream = stream();
    let cancelled = stream.on_turn_finished(StopReason::Cancelled, 0);
    let SessionUpdate::StateUpdate(WireSessionState::Idle(idle)) = &cancelled[0] else {
        panic!("expected Idle, got {:?}", cancelled[0]);
    };
    assert_eq!(idle.stop_reason, Some(StopReason::Cancelled));

    let errored = stream.on_turn_finished(StopReason::Error, 10);
    let SessionUpdate::StateUpdate(WireSessionState::Idle(idle)) = &errored[0] else {
        panic!("expected Idle, got {:?}", errored[0]);
    };
    assert_eq!(idle.stop_reason, Some(StopReason::Error));
    let wire = serde_json::to_value(&errored[0]).unwrap();
    assert_eq!(wire["stopReason"], json!("_mainframe.dev/error"));
}
