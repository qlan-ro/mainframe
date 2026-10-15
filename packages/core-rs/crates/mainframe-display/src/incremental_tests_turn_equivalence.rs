//! Equivalence with turn-group boundaries: a known change of `turnGroup` (or
//! Codex presentation turn) closes the open assistant accumulator, so the
//! projector's chunked fold must split exactly where `group_messages` does —
//! on append, under a streaming overlay, and after a structural rewind.

use crate::{RawChange, RawChanges};
use mainframe_types::chat::ChatMessage;
use mainframe_types::transcript_presentation::TURN_GROUP_KEY;
use serde_json::json;

use super::harness::*;
use crate::display_pipeline::prepare_messages_for_client;

fn appended() -> RawChanges {
    let mut c = RawChanges::new();
    c.push(RawChange::Appended);
    c
}

fn keyed(mut message: ChatMessage, key: &str) -> ChatMessage {
    message
        .metadata
        .get_or_insert_default()
        .insert(TURN_GROUP_KEY.into(), json!(key));
    message
}

fn container_count(raw: &[ChatMessage]) -> usize {
    prepare_messages_for_client(raw, None).len()
}

#[test]
fn hidden_prompt_replies_stay_separate_through_appends_and_overlay() {
    let mut h = Harness::new();
    h.raw.push(user("u1", "go"));
    h.step(appended(), None);
    h.raw.push(keyed(
        assistant("a1", vec![text("Working"), tool_use("tu1", "Bash")]),
        "p1",
    ));
    h.step(appended(), None);
    h.raw
        .push(tool_result_msg("r1", vec![tool_result("tu1", "ok")]));
    h.step(appended(), None);
    h.raw
        .push(keyed(assistant("a2", vec![text("Done.")]), "p1"));
    h.step(appended(), None);

    // A hidden task-notification prompt produced the next reply: no user
    // message separates it, only its prompt group.
    let partial = keyed(assistant("a3", vec![text("Limit")]), "p2");
    h.step(RawChanges::new(), Some(&partial));
    h.raw
        .push(keyed(assistant("a3", vec![text("Limit hit")]), "p2"));
    h.step(appended(), None);
    h.raw
        .push(keyed(assistant("a4", vec![text("Limit hit")]), "p3"));
    h.step(appended(), None);
    // Unknown provenance joins the open group.
    h.raw.push(assistant("a5", vec![text("tail")]));
    h.step(appended(), None);
    assert_eq!(container_count(&h.raw), 4);
}

#[test]
fn a_structural_change_reconsiders_the_previous_turn_boundary() {
    let mut h = Harness::new();
    h.raw.push(keyed(assistant("a1", vec![text("one")]), "p1"));
    h.raw.push(keyed(assistant("a2", vec![text("two")]), "p2"));
    h.step(appended(), None);
    assert_eq!(container_count(&h.raw), 2);

    if let Some(meta) = h.raw[1].metadata.as_mut() {
        meta.insert(TURN_GROUP_KEY.into(), json!("p1"));
    }
    let mut changes = RawChanges::new();
    changes.push(RawChange::Structural(1));
    h.step(changes, None);
    assert_eq!(container_count(&h.raw), 1);
}

#[test]
fn codex_turns_split_when_the_user_item_is_omitted() {
    let codex = |message: ChatMessage, turn: &str| {
        let mut message = message;
        message.metadata.get_or_insert_default().insert(
            "transcriptPresentation".into(),
            json!({"version":1,"provider":"codex","turnId":turn,"state":"completed","finalEligible":false}),
        );
        message
    };
    let mut h = Harness::new();
    h.raw.push(codex(
        assistant("c1", vec![tool_use("tc1", "Bash")]),
        "[\"th\",\"t1\"]",
    ));
    h.step(appended(), None);
    h.raw
        .push(tool_result_msg("cr1", vec![tool_result("tc1", "ok")]));
    h.step(appended(), None);
    h.raw.push(codex(
        assistant("c2", vec![text("first")]),
        "[\"th\",\"t1\"]",
    ));
    h.step(appended(), None);
    h.raw.push(codex(
        assistant("c3", vec![text("second")]),
        "[\"th\",\"t2\"]",
    ));
    h.step(appended(), None);
    assert_eq!(container_count(&h.raw), 2);
}

#[test]
fn the_turn_group_key_never_reaches_display_metadata() {
    let raw = vec![keyed(assistant("a1", vec![text("x")]), "p1")];
    let display = prepare_messages_for_client(&raw, None);
    assert_eq!(display.len(), 1);
    assert!(display[0].metadata.is_none());
}
