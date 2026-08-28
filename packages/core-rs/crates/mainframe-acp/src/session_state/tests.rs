use super::*;
use crate::encoder::{EncodedItem, ItemRole};
use mainframe_types::acp::tool_call::{ToolCallContent, ToolCallStatus, ToolKind};

fn text_block(text: &str) -> ContentBlock {
    ContentBlock::Text {
        text: text.to_string(),
        meta: None,
    }
}

fn image_block(data: &str) -> ContentBlock {
    ContentBlock::Image {
        data: data.to_string(),
        mime_type: "image/png".to_string(),
        uri: None,
        meta: None,
    }
}

fn msg(id: &str, text: &str) -> EncodedItem {
    msg_blocks(id, vec![text_block(text)])
}

fn msg_blocks(id: &str, content: Vec<ContentBlock>) -> EncodedItem {
    EncodedItem::Message {
        id: id.to_string(),
        role: ItemRole::Agent,
        content,
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
fn tail_text_growth_plus_an_appended_image_emits_a_delta_chunk_then_an_image_chunk() {
    let mut state = SessionState::new();
    state.diff(&[msg("m1", "Here is the shot")]);

    let updates = state.diff(&[msg_blocks(
        "m1",
        vec![text_block("Here is the shot:"), image_block("aGk=")],
    )]);

    assert_eq!(updates.len(), 2);
    let SessionUpdate::AgentMessageChunk(delta) = &updates[0] else {
        panic!("expected a text delta chunk first");
    };
    assert_eq!(delta.content, text_block(":"));
    let SessionUpdate::AgentMessageChunk(image) = &updates[1] else {
        panic!("expected the appended image chunk second");
    };
    assert_eq!(image.content, image_block("aGk="));
}

#[test]
fn text_growth_after_an_image_block_emits_the_new_text_block_as_a_chunk() {
    let mut state = SessionState::new();
    state.diff(&[msg_blocks(
        "m1",
        vec![text_block("Before"), image_block("aGk=")],
    )]);

    let updates = state.diff(&[msg_blocks(
        "m1",
        vec![
            text_block("Before"),
            image_block("aGk="),
            text_block("After"),
        ],
    )]);

    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessageChunk(chunk) = &updates[0] else {
        panic!("expected a chunk");
    };
    // The client's trailing block is the image, so this text chunk starts a
    // new block rather than coalescing — the multi-block append case.
    assert_eq!(chunk.content, text_block("After"));

    // ...and that new trailing text block then grows by delta chunks.
    let updates = state.diff(&[msg_blocks(
        "m1",
        vec![
            text_block("Before"),
            image_block("aGk="),
            text_block("After all"),
        ],
    )]);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessageChunk(chunk) = &updates[0] else {
        panic!("expected a chunk");
    };
    assert_eq!(chunk.content, text_block(" all"));
}

#[test]
fn a_mid_list_divergence_is_a_full_multi_block_upsert() {
    let mut state = SessionState::new();
    state.diff(&[msg_blocks(
        "m1",
        vec![text_block("draft"), image_block("aGk=")],
    )]);

    // The retry rewrote the first block — not expressible as appends.
    let updates = state.diff(&[msg_blocks(
        "m1",
        vec![text_block("final"), image_block("aGk=")],
    )]);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessage(upsert) = &updates[0] else {
        panic!("a mid-list divergence must be a full upsert, not chunks");
    };
    assert_eq!(
        upsert.content,
        Some(Some(vec![text_block("final"), image_block("aGk=")]))
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
