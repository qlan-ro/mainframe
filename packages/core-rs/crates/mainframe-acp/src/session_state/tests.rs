use super::*;
use crate::encoder::{EncodedItem, ItemRole};
use mainframe_types::acp::tool_call::{ToolCallContent, ToolCallStatus, ToolKind};

fn msg(id: &str, text: &str) -> EncodedItem {
    EncodedItem::Message {
        id: id.to_string(),
        role: ItemRole::Agent,
        text: text.to_string(),
        meta: None,
    }
}

fn tool(id: &str, status: ToolCallStatus, content: Vec<ToolCallContent>) -> EncodedItem {
    EncodedItem::ToolCall {
        id: id.to_string(),
        title: "Read".to_string(),
        kind: ToolKind::Read,
        status,
        raw_input: Value::Null,
        content,
        meta: None,
    }
}

#[test]
fn a_new_id_produces_a_full_upsert_with_content() {
    let mut state = SessionState::new();
    let updates = state.diff(&[msg("m1", "hello")]);

    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessage(upsert) = &updates[0] else {
        panic!("expected AgentMessage");
    };
    assert_eq!(upsert.message_id, "m1");
    assert_eq!(
        upsert.content,
        Some(Some(vec![ContentBlock::Text {
            text: "hello".to_string(),
            meta: None
        }]))
    );
}

#[test]
fn an_unchanged_item_produces_no_update() {
    let mut state = SessionState::new();
    state.diff(&[msg("m1", "hello")]);

    let updates = state.diff(&[msg("m1", "hello")]);
    assert!(updates.is_empty());
}

#[test]
fn a_pure_suffix_growth_produces_a_chunk_with_only_the_delta() {
    let mut state = SessionState::new();
    state.diff(&[msg("m1", "Look")]);

    let updates = state.diff(&[msg("m1", "Looking into it")]);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessageChunk(chunk) = &updates[0] else {
        panic!("expected AgentMessageChunk");
    };
    assert_eq!(chunk.message_id, "m1");
    assert_eq!(
        chunk.content,
        ContentBlock::Text {
            text: "ing into it".to_string(),
            meta: None
        }
    );
}

#[test]
fn a_non_append_change_is_a_full_revision_not_a_chunk() {
    let mut state = SessionState::new();
    state.diff(&[msg("m1", "Looking into it")]);

    // A retry replaced the content wholesale — not a suffix of the prior text.
    let updates = state.diff(&[msg("m1", "Looking into it")]);
    assert!(updates.is_empty(), "sanity: identical text is a no-op");

    let updates = state.diff(&[msg("m1", "Retried from scratch")]);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessage(upsert) = &updates[0] else {
        panic!("a non-append change must be a full upsert, not a chunk");
    };
    assert_eq!(
        upsert.content,
        Some(Some(vec![ContentBlock::Text {
            text: "Retried from scratch".to_string(),
            meta: None
        }]))
    );
}

#[test]
fn a_tool_call_status_change_patches_only_the_changed_field() {
    let mut state = SessionState::new();
    state.diff(&[tool("t1", ToolCallStatus::InProgress, Vec::new())]);

    let updates = state.diff(&[tool(
        "t1",
        ToolCallStatus::Completed,
        vec![ToolCallContent::Content {
            content: ContentBlock::Text {
                text: "done".to_string(),
                meta: None,
            },
        }],
    )]);

    assert_eq!(updates.len(), 1);
    let SessionUpdate::ToolCallUpdate(patch) = &updates[0] else {
        panic!("expected ToolCallUpdate");
    };
    assert_eq!(patch.tool_call_id, "t1");
    assert_eq!(patch.status, Some(Some(ToolCallStatus::Completed)));
    assert!(patch.content.is_some());
    // Unchanged fields stay omitted (patch grammar): title/kind/raw_input
    // never differed between the two snapshots.
    assert_eq!(patch.title, None);
    assert_eq!(patch.kind, None);
    assert_eq!(patch.raw_input, None);
}

#[test]
fn a_fresh_session_state_creates_every_item_even_ones_seen_by_another_session() {
    // Two independent SessionState instances (two attached facade sessions)
    // must not share history: a resumed/newly-attached session sees a
    // create for an item another session already has.
    let mut first = SessionState::new();
    first.diff(&[msg("m1", "hello")]);

    let mut second = SessionState::new();
    let updates = second.diff(&[msg("m1", "hello")]);
    assert_eq!(updates.len(), 1);
    assert!(matches!(updates[0], SessionUpdate::AgentMessage(_)));
}
