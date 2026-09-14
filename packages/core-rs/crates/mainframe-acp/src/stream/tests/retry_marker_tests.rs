//! Retry-marker attachment cases for `SessionStream` — meta carriage,
//! namespace extension without clobbering the parent relation, the
//! no-carrier wait, and the clearing-upsert/tool-call-patch skip — split
//! out of `tests.rs` (todo #350, plan task 37, R2.13).

use serde_json::json;

use super::*;
use mainframe_types::acp::tool_call::ToolCallStatus;

#[test]
fn a_retry_marker_rides_the_next_upsert_meta_and_is_consumed_once() {
    let mut stream = stream();
    stream.on_retry(marker());

    let updates = stream.on_revision(&[message("m1", "Retried and completed.")], 0);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessage(upsert) = as_update(&updates[0]) else {
        panic!("expected an upsert, got {:?}", updates[0]);
    };
    let meta = upsert.meta.clone().flatten().expect("marker meta expected");
    assert_eq!(
        meta[MAINFRAME_META_NAMESPACE],
        json!({ "attempt": 2, "reason": "overloaded_error" })
    );

    // Consumed: the next revision carries no marker.
    let next = stream.on_revision(&[message("m1", "Retried and completed. More")], 10);
    let SessionUpdate::AgentMessageChunk(chunk) = as_update(&next[0]) else {
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
    let SessionUpdate::AgentMessage(upsert) = as_update(&updates[0]) else {
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
    assert!(matches!(
        as_update(&chunk_only[0]),
        SessionUpdate::AgentMessageChunk(_)
    ));

    // The turn ends before any upsert appears: the marker must not survive
    // into the next turn's unrelated revision.
    let _ = stream.on_turn_finished(StopReason::EndTurn, 20);
    let next_turn = stream.on_revision(&[message("m2", "fresh")], 30);
    let SessionUpdate::AgentMessage(upsert) = as_update(&next_turn[0]) else {
        panic!("expected an upsert, got {:?}", next_turn[0]);
    };
    assert_eq!(upsert.meta, None);
}

#[test]
fn a_retry_marker_skips_a_clearing_upsert_and_a_tool_call_patch() {
    let mut stream = stream();
    let _ = stream.on_revision(
        &[message("m1", "Hel"), tool("t1", ToolCallStatus::Pending)],
        0,
    );
    stream.on_retry(marker());

    // m1 vanishes (its aborted partial content is cleared) in the same
    // revision the tool call patches — neither may claim the marker.
    let batch = stream.on_revision(&[tool("t1", ToolCallStatus::InProgress)], 10);
    assert_eq!(
        batch.len(),
        2,
        "expected a clear plus a tool patch: {batch:?}"
    );
    for frame in &batch {
        match as_update(frame) {
            SessionUpdate::AgentMessage(upsert) => assert_eq!(upsert.meta, None),
            SessionUpdate::ToolCallUpdate(patch) => assert_eq!(patch.meta, None),
            other => panic!("unexpected frame: {other:?}"),
        }
    }

    // The retry's own first content frame is the one that finally carries it.
    let carrier = stream.on_revision(
        &[
            message("m2", "Retried."),
            tool("t1", ToolCallStatus::InProgress),
        ],
        20,
    );
    let SessionUpdate::AgentMessage(upsert) = as_update(&carrier[0]) else {
        panic!("expected an upsert, got {:?}", carrier[0]);
    };
    let meta = upsert.meta.clone().flatten().expect("marker meta expected");
    assert_eq!(meta[MAINFRAME_META_NAMESPACE]["attempt"], json!(2));
}
