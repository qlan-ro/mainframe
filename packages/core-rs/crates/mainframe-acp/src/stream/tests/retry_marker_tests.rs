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

    let updates = stream.on_revision(&[message("m1", "Retried and completed.")], 0, None);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessage(upsert) = as_update(&updates[0]) else {
        panic!("expected an upsert, got {:?}", updates[0]);
    };
    let meta = upsert.meta.clone().flatten().expect("marker meta expected");
    assert_eq!(
        meta[MAINFRAME_META_NAMESPACE],
        json!({ "attempt": 2, "reason": "overloaded_error", "created": true })
    );

    // Consumed: the next revision carries no marker.
    let next = stream.on_revision(&[message("m1", "Retried and completed. More")], 10, None);
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
        None,
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
    let _ = stream.on_revision(&[message("m1", "Hel")], 0, None);

    // A pure append is a chunk — no carrier, marker stays pending.
    stream.on_retry(marker());
    let chunk_only = stream.on_revision(&[message("m1", "Hello")], 10, None);
    assert!(matches!(
        as_update(&chunk_only[0]),
        SessionUpdate::AgentMessageChunk(_)
    ));

    // The turn ends before any upsert appears: the marker must not survive
    // into the next turn's unrelated revision.
    let _ = stream.on_turn_finished(StopReason::EndTurn, 20);
    // m1 vanishing clears it alongside m2's creation; neither frame may
    // carry the dropped marker. The clear's own `_meta: null` is the clear
    // signal, not a payload, so assert on the flattened meta.
    let next_turn = stream.on_revision(&[message("m2", "fresh")], 30, None);
    for frame in &next_turn {
        let SessionUpdate::AgentMessage(upsert) = as_update(frame) else {
            panic!("expected message upserts, got {frame:?}");
        };
        let meta = upsert.meta.clone().flatten();
        if upsert.message_id == "m1" {
            assert_eq!(meta, None, "m1's clear carries no payload meta");
        } else {
            // m2 is a fresh id, so its own creation frame now carries the
            // (unrelated) `created` marker — the dropped retry marker is
            // what must be absent from it.
            assert_eq!(
                meta.expect("m2's creation carries the created marker")[MAINFRAME_META_NAMESPACE],
                json!({ "created": true }),
                "the dropped retry marker must not reach m2's creation"
            );
        }
    }
}

/// Finding 8: a full-revision upsert whose meta did NOT change wires `meta`
/// as the omitted patch (`None`), not a value — `attach_retry_marker` must
/// never treat that as a carrier, or `merge_namespace` would start from an
/// empty object and wire `_meta` as JUST `{attempt, reason}`, discarding the
/// item's `containerId` (Bug 1's symptom: the item becomes its own container
/// at the tail). The marker waits for the next upsert whose meta IS a full
/// value.
#[test]
fn a_retry_marker_never_replaces_a_full_meta_with_marker_only() {
    let mut stream = stream();
    let existing_meta = json!({ MAINFRAME_META_NAMESPACE: { "containerId": "m1" } });
    let _ = stream.on_revision(
        &[message_with_meta("m1", "Hel", existing_meta.clone())],
        0,
        None,
    );

    stream.on_retry(marker());

    // A non-append change (full revision) whose meta is unchanged: the wire
    // `meta` stays omitted, so this frame must not claim the marker.
    let updates = stream.on_revision(
        &[message_with_meta(
            "m1",
            "Retried from scratch",
            existing_meta.clone(),
        )],
        10,
        None,
    );
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessage(upsert) = as_update(&updates[0]) else {
        panic!("expected a full revision upsert");
    };
    assert_eq!(
        upsert.meta, None,
        "an unchanged meta must stay omitted, never become marker-only"
    );

    // The marker is still pending: the next upsert that DOES carry a full
    // meta value is the one that finally gets it, with the existing fields
    // (`containerId`) intact.
    let new_meta = json!({
        MAINFRAME_META_NAMESPACE: { "containerId": "m1", "turnDurationMs": 5 }
    });
    let carrier = stream.on_revision(
        &[message_with_meta("m1", "Retried again", new_meta)],
        20,
        None,
    );
    assert_eq!(carrier.len(), 1);
    let SessionUpdate::AgentMessage(upsert) = as_update(&carrier[0]) else {
        panic!("expected an upsert");
    };
    let meta = upsert.meta.clone().flatten().expect("marker meta expected");
    assert_eq!(meta[MAINFRAME_META_NAMESPACE]["attempt"], json!(2));
    assert_eq!(
        meta[MAINFRAME_META_NAMESPACE]["containerId"],
        json!("m1"),
        "existing meta fields survive the merge"
    );
}

#[test]
fn a_retry_marker_skips_a_clearing_upsert_and_a_tool_call_patch() {
    let mut stream = stream();
    let _ = stream.on_revision(
        &[message("m1", "Hel"), tool("t1", ToolCallStatus::Pending)],
        0,
        None,
    );
    stream.on_retry(marker());

    // m1 vanishes (its aborted partial content is cleared) in the same
    // revision the tool call patches — neither may claim the marker.
    let batch = stream.on_revision(&[tool("t1", ToolCallStatus::InProgress)], 10, None);
    assert_eq!(
        batch.len(),
        2,
        "expected a clear plus a tool patch: {batch:?}"
    );
    for frame in &batch {
        match as_update(frame) {
            // The clear frame's meta is an explicit `null` (the clear
            // signal); what must be absent is the marker inside it.
            SessionUpdate::AgentMessage(upsert) => {
                assert_eq!(upsert.meta.clone().flatten(), None)
            }
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
        None,
    );
    let SessionUpdate::AgentMessage(upsert) = as_update(&carrier[0]) else {
        panic!("expected an upsert, got {:?}", carrier[0]);
    };
    let meta = upsert.meta.clone().flatten().expect("marker meta expected");
    assert_eq!(meta[MAINFRAME_META_NAMESPACE]["attempt"], json!(2));
}
