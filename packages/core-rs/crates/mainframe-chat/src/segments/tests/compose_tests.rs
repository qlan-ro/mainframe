//! `partition` + `assemble`: one transcript per native session split back
//! into segments, dividers between them, borrowed bounds, stable ids.

use std::collections::HashMap;

use mainframe_types::chat::{ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::segment::{HandoffStatus, SegmentKind};

use super::*;
use crate::segments::compose::assemble;
use crate::segments::divider::{divider_id, is_divider};
use crate::segments::partition::bound;

fn loaded() -> HashMap<String, Vec<ChatMessage>> {
    HashMap::from([
        (
            "ns_c".to_string(),
            vec![
                user("c-u1", "start"),
                assistant("c-a1", "claude answer"),
                marked_user("c-u2", "s2", "back again"),
                assistant("c-a2", "claude caught up"),
            ],
        ),
        (
            "ns_x".to_string(),
            vec![
                marked_user("x-u1", "s1", "review it"),
                assistant("x-a1", "codex answer"),
            ],
        ),
    ])
}

#[test]
fn claude_codex_claude_partitions_into_three_spans_with_two_dividers() {
    let composed = assemble("chat_1", &c_x_c(), loaded(), &name_of);
    let ids: Vec<&str> = composed.messages.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "c-u1",
            "c-a1",
            "segdiv-s1",
            "x-u1",
            "x-a1",
            "segdiv-s2",
            "c-u2",
            "c-a2"
        ]
    );
    assert_eq!(composed.active_from, 6);
    // The markers are stripped, so cold text equals what the user typed.
    assert_eq!(text_of(&composed.messages[3]), "review it");
    assert_eq!(text_of(&composed.messages[6]), "back again");
}

#[test]
fn divider_markers_name_both_providers_and_the_return() {
    let composed = assemble("chat_1", &c_x_c(), loaded(), &name_of);
    let marker = |index: usize| match &composed.messages[index].content[0] {
        MessageContent::Node(MessageContentNode::ProviderSwitch { marker }) => marker.clone(),
        _ => panic!("not a divider"),
    };
    let first = marker(2);
    assert_eq!(
        (
            first.from_adapter_name.as_str(),
            first.to_adapter_name.as_str()
        ),
        ("Claude", "Codex")
    );
    assert!(!first.resumed);
    let second = marker(5);
    assert!(second.resumed);
    assert_eq!(
        second.handoff.as_ref().map(|h| h.status),
        Some(HandoffStatus::Delivered)
    );
    assert_eq!(composed.messages[5].r#type, ChatMessageType::System);
    assert_eq!(composed.messages[5].id, divider_id("s2"));
}

#[test]
fn a_missing_marker_keeps_messages_with_the_previous_segment() {
    let mut transcripts = loaded();
    transcripts.insert(
        "ns_c".into(),
        vec![
            user("c-u1", "start"),
            assistant("c-a1", "a"),
            user("c-u2", "no marker"),
            assistant("c-a2", "b"),
        ],
    );
    let composed = assemble("chat_1", &c_x_c(), transcripts, &name_of);
    let ids: Vec<&str> = composed.messages.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "c-u1",
            "c-a1",
            "c-u2",
            "c-a2",
            "segdiv-s1",
            "x-u1",
            "x-a1",
            "segdiv-s2"
        ]
    );
}

#[test]
fn a_pasted_marker_for_another_session_splits_nothing() {
    let mut transcripts = loaded();
    transcripts.insert(
        "ns_c".into(),
        vec![user("c-u1", "start"), marked_user("c-u2", "s1", "pasted")],
    );
    let composed = assemble("chat_1", &c_x_c(), transcripts, &name_of);
    // s1 lives on ns_x, so the marker on ns_c is ignored and left verbatim.
    assert_eq!(composed.messages[1].id, "c-u2");
    assert!(text_of(&composed.messages[1]).starts_with("<mainframe-context-handoff"));
}

#[test]
fn a_pending_segment_shows_its_divider_and_an_empty_slice() {
    let mut layout = c_x_c();
    layout.segments.truncate(2);
    layout.segments[1].closed_at = None;
    layout.natives[1].native_session_id = None;
    layout.handoffs.clear();
    let mut transcripts = loaded();
    transcripts.remove("ns_x");
    let composed = assemble("chat_1", &layout, transcripts, &name_of);
    let last = composed.messages.last().unwrap();
    assert!(is_divider(last));
    assert_eq!(composed.active_from, composed.messages.len());
}

#[test]
fn borrowed_segments_are_bounded_by_id_then_by_time() {
    let messages = vec![user("a", "1"), assistant("b", "2"), user("c", "3")];
    assert_eq!(bound(messages.clone(), Some("b"), None).len(), 2);
    let mut late = messages.clone();
    late[2].timestamp = "2026-10-07T00:00:00Z".into();
    assert_eq!(
        bound(late, Some("gone"), Some("2026-10-06T12:00:00Z")).len(),
        2
    );
    assert_eq!(bound(messages, None, None).len(), 3);
}

#[test]
fn a_context_reset_divider_says_the_context_was_cleared() {
    let mut layout = c_x_c();
    layout.segments.truncate(1);
    layout
        .segments
        .push(segment("r1", 1, "ns_r", SegmentKind::ContextReset));
    layout.segments[1].closed_at = None;
    layout.natives.push(native("ns_r", "claude", Some("c-2")));
    let composed = assemble("chat_1", &layout, HashMap::new(), &name_of);
    let MessageContent::Node(MessageContentNode::ProviderSwitch { marker }) =
        &composed.messages[0].content[0]
    else {
        panic!("expected the divider");
    };
    assert_eq!(
        marker.label(),
        "New Claude session · earlier context cleared"
    );
}
