//! `SessionState::diff`'s vanish/fresh-session/retry cases — split out of
//! `tests.rs` (todo #350, plan task 37, R2.13). The parent file keeps the
//! per-item revision/chunking/meta cases; this one covers what happens at
//! the whole-snapshot level when an item disappears or a session starts
//! fresh. Builders duplicated rather than shared (three lines each,
//! `tests.rs`'s own pattern for its sibling test files).

use super::*;
use crate::encoder::{EncodedItem, ItemRole};
use mainframe_types::acp::tool_call::{ToolCallContent, ToolCallStatus, ToolKind};

fn text_block(text: &str) -> ContentBlock {
    ContentBlock::Text {
        text: text.to_string(),
        meta: None,
    }
}

fn msg(id: &str, text: &str) -> EncodedItem {
    EncodedItem::Message {
        id: id.to_string(),
        role: ItemRole::Agent,
        content: vec![text_block(text)],
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

#[test]
fn a_vanished_message_item_gets_one_clearing_upsert_then_is_forgotten() {
    let mut state = SessionState::new();
    state.diff(&[msg("m1", "doomed partial")]);

    // The overlay aborted (retry/interrupt): the item is gone wholesale.
    let updates = state.diff(&[]);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessage(upsert) = &updates[0] else {
        panic!("expected a clearing AgentMessage upsert");
    };
    assert_eq!(upsert.message_id, "m1");
    assert_eq!(upsert.content, Some(Some(Vec::new())));
    // `Some(None)` wires as an explicit `"_meta": null` — what tells the
    // client this is a clear and not an empty-content item whose payload is
    // its meta (a skill-loaded or compaction pill).
    assert_eq!(upsert.meta, Some(None));

    // Forgotten: staying absent is quiet, reappearing is a fresh creation.
    assert!(state.diff(&[]).is_empty());
    let recreated = state.diff(&[msg("m1", "retried text")]);
    assert_eq!(recreated.len(), 1);
    assert!(matches!(recreated[0], SessionUpdate::AgentMessage(_)));
}

#[test]
fn a_vanished_thought_item_clears_as_a_thought() {
    let mut state = SessionState::new();
    state.diff(&[EncodedItem::Thought {
        id: "m1-thought".to_string(),
        content: vec![text_block("thinking...")],
        meta: None,
    }]);

    let updates = state.diff(&[]);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentThought(upsert) = &updates[0] else {
        panic!("expected a clearing AgentThought upsert");
    };
    assert_eq!(upsert.content, Some(Some(Vec::new())));
    assert_eq!(upsert.meta, Some(None));
}

#[test]
fn a_vanished_tool_call_is_left_as_is() {
    let mut state = SessionState::new();
    state.diff(&[tool("t1", ToolCallStatus::InProgress, Vec::new())]);

    assert!(state.diff(&[]).is_empty());
}

#[test]
fn a_retry_replacing_the_partial_item_clears_the_old_and_creates_the_new() {
    let mut state = SessionState::new();
    state.diff(&[msg("msg_A", "partial before retry")]);

    let updates = state.diff(&[msg("msg_B", "retried")]);
    assert_eq!(updates.len(), 2);
    let SessionUpdate::AgentMessage(clear) = &updates[0] else {
        panic!("expected the clear first");
    };
    assert_eq!(clear.message_id, "msg_A");
    assert_eq!(clear.content, Some(Some(Vec::new())));
    assert_eq!(clear.meta, Some(None));
    let SessionUpdate::AgentMessage(create) = &updates[1] else {
        panic!("expected the creation second");
    };
    assert_eq!(create.message_id, "msg_B");
}
