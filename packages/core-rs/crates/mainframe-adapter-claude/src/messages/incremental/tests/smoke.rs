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

#[test]
fn appending_after_an_empty_seed_folds_the_new_message() {
    // Regression: `session/resume` reaches
    // `display_snapshot` before the chat's first prompt, so the projector's
    // very first call is a `full_rebuild` on an empty `raw` slice, leaving
    // `groups == []`. The next call — the first real append — must not
    // treat that empty-groups state as "nothing left to fold".
    let mut projector = IncrementalProjector::new();
    let empty: Vec<ChatMessage> = Vec::new();
    let seeded = projector.project(input(&empty, RawChanges::new()));
    assert!(seeded.full);
    assert_eq!(seeded.len, 0);

    let mut raw = vec![text_msg("01", ChatMessageType::User, "hi")];
    let mut changes = RawChanges::new();
    changes.push(RawChange::Appended);
    let first_append = projector.project(input(&raw, changes));
    assert!(!first_append.full);
    assert_eq!(first_append.len, 1, "the first message must be folded");
    assert_eq!(first_append.changes.len(), 1);
    assert_eq!(first_append.changes[0].0, 0);
    assert!(
        first_append.stats.raw_folded > 0,
        "the projector must actually fold the new raw message"
    );

    raw.push(text_msg("02", ChatMessageType::User, "again"));
    let mut changes = RawChanges::new();
    changes.push(RawChange::Appended);
    let second_append = projector.project(input(&raw, changes));
    assert!(!second_append.full);
    assert_eq!(second_append.len, 2, "both messages must be folded");
    // `baseline_rewind_point` always rewinds through the last existing
    // group on any append (it may turn out to be extendable), so both
    // ordinal 0 (re-emitted, unchanged) and the new ordinal 1 show up here.
    let ordinals: Vec<usize> = second_append.changes.iter().map(|(o, _)| *o).collect();
    assert_eq!(ordinals, vec![0, 1]);
    assert!(second_append.stats.raw_folded > 0);
}
