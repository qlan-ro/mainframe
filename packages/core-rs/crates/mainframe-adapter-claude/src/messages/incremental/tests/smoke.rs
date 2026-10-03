use crate::messages::incremental::IncrementalProjector;
use mainframe_display::{DisplayProjector, ProjectionInput, RawChange, RawChanges};
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use mainframe_types::content::LeafContent;

fn text_msg(id: &str, t: ChatMessageType, text: &str) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c".to_string(),
        r#type: t,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: text.to_string(),
            parent_tool_use_id: None,
        })],
        timestamp: format!("2026-01-01T00:00:{id}.000Z"),
        metadata: None,
    }
}

fn input<'a>(raw: &'a [ChatMessage], changes: RawChanges) -> ProjectionInput<'a> {
    ProjectionInput {
        raw,
        changes,
        overlay: None,
        categories: None,
    }
}

#[test]
fn first_call_is_always_full() {
    let mut projector = IncrementalProjector::new();
    let raw = vec![text_msg("01", ChatMessageType::User, "hi")];
    let out = projector.project(input(&raw, RawChanges::new()));
    assert!(out.full);
    assert_eq!(out.len, 1);
}

#[test]
fn appending_text_into_the_active_assistant_turn_merges_into_its_container() {
    let mut projector = IncrementalProjector::new();
    // Two settled containers: a user turn, then an assistant turn already
    // streaming.
    let mut raw = vec![
        text_msg("01", ChatMessageType::User, "hi"),
        text_msg("02", ChatMessageType::Assistant, "hel"),
    ];
    let first = projector.project(input(&raw, RawChanges::new()));
    assert!(first.full);
    assert_eq!(first.len, 2);

    // `append_live` extends the same assistant turn's raw content in place.
    raw[1] = text_msg("02", ChatMessageType::Assistant, "hello");
    let mut changes = RawChanges::new();
    changes.push(RawChange::Appended);
    let second = projector.project(input(&raw, changes));
    assert!(!second.full);
    assert_eq!(second.len, 2, "the active turn stays one container");
    assert_eq!(
        second.changes.len(),
        1,
        "only the active container is touched, never the settled user turn"
    );
    assert_eq!(second.changes[0].0, 1);
}
