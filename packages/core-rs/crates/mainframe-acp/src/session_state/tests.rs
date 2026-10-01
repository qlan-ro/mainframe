use super::*;
use crate::encoder::{EncodedItem, ItemRole};
use mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE;
use mainframe_types::acp::tool_call::{ToolCallStatus, ToolKind};

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
fn a_meta_only_change_patches_meta_without_resending_content() {
    // The live defect behind e2e criterion 3/7 failures: turn end attaches
    // `turnDurationMs` to the item meta while content is unchanged — that
    // must be a meta-only patch, never a full content re-send.
    let mut state = SessionState::new();
    state.diff(&[msg("m1", "hello")]);

    let updates = state.diff(&[EncodedItem::Message {
        id: "m1".to_string(),
        role: ItemRole::Agent,
        content: vec![text_block("hello")],
        meta: Some(serde_json::json!({ "turnDurationMs": 121 })),
    }]);

    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessage(upsert) = &updates[0] else {
        panic!("expected AgentMessage");
    };
    assert_eq!(
        upsert.content, None,
        "content must stay omitted (unchanged)"
    );
    assert_eq!(
        upsert.meta,
        Some(Some(serde_json::json!({ "turnDurationMs": 121 })))
    );
}

#[test]
fn a_meta_only_change_on_a_thought_patches_as_a_thought() {
    let mut state = SessionState::new();
    let thought = |meta: Option<Value>| EncodedItem::Thought {
        id: "m1-thought".to_string(),
        content: vec![text_block("thinking...")],
        meta,
    };
    state.diff(&[thought(None)]);

    let updates = state.diff(&[thought(Some(serde_json::json!({ "turnDurationMs": 7 })))]);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentThought(upsert) = &updates[0] else {
        panic!("expected AgentThought");
    };
    assert_eq!(upsert.content, None);
    assert_eq!(
        upsert.meta,
        Some(Some(serde_json::json!({ "turnDurationMs": 7 })))
    );
}

#[test]
fn a_cleared_meta_wires_as_an_explicit_null_patch() {
    let mut state = SessionState::new();
    state.diff(&[EncodedItem::Message {
        id: "m1".to_string(),
        role: ItemRole::Agent,
        content: vec![text_block("hello")],
        meta: Some(serde_json::json!({ "turnDurationMs": 121 })),
    }]);

    let updates = state.diff(&[msg("m1", "hello")]);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessage(upsert) = &updates[0] else {
        panic!("expected AgentMessage");
    };
    assert_eq!(upsert.content, None);
    // `Some(None)` serializes as `"_meta": null` — the patch grammar's clear.
    assert_eq!(upsert.meta, Some(None));
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

/// Spec Decision 39: dropping `ItemMeta.streaming` needs no special-casing in
/// the diff engine — it is just another meta change, so it rides whichever
/// shape `content_revision` already picks: a meta-only patch when content is
/// unchanged, or the new meta on the first chunk when content also grew.
#[test]
fn a_streaming_drop_is_a_meta_patch_in_the_same_diff() {
    let with_streaming = serde_json::json!({ "containerId": "m1", "streaming": true });
    let without_streaming = serde_json::json!({ "containerId": "m1" });

    // Unchanged content: a meta-only upsert, content omitted.
    let mut state = SessionState::new();
    state.diff(&[EncodedItem::Message {
        id: "m1".to_string(),
        role: ItemRole::Agent,
        content: vec![text_block("Riv")],
        meta: Some(with_streaming.clone()),
    }]);

    let updates = state.diff(&[EncodedItem::Message {
        id: "m1".to_string(),
        role: ItemRole::Agent,
        content: vec![text_block("Riv")],
        meta: Some(without_streaming.clone()),
    }]);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessage(upsert) = &updates[0] else {
        panic!("expected an AgentMessage upsert");
    };
    assert_eq!(upsert.content, None, "content stays omitted, unchanged");
    assert_eq!(upsert.meta, Some(Some(without_streaming.clone())));

    // Added text AND a dropped flag: one chunk, carrying the new meta.
    let mut state = SessionState::new();
    state.diff(&[EncodedItem::Message {
        id: "m2".to_string(),
        role: ItemRole::Agent,
        content: vec![text_block("Riv")],
        meta: Some(with_streaming),
    }]);

    let updates = state.diff(&[EncodedItem::Message {
        id: "m2".to_string(),
        role: ItemRole::Agent,
        content: vec![text_block("Rivers flow")],
        meta: Some(without_streaming.clone()),
    }]);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessageChunk(chunk) = &updates[0] else {
        panic!("expected a chunk");
    };
    assert_eq!(chunk.content, text_block("ers flow"));
    assert_eq!(
        chunk.meta,
        Some(without_streaming),
        "the chunk that drops the flag carries the new meta"
    );
}

/// Spec Decision 37: a new item's complete first frame (live or replayed)
/// carries `_meta["_mainframe.dev"].created: true`, and nothing else does —
/// not a chunk, a meta-only patch, a full revision, a clear, or a tool-call
/// patch.
#[test]
fn only_creations_carry_the_created_marker() {
    fn tool(id: &str, status: ToolCallStatus) -> EncodedItem {
        EncodedItem::ToolCall {
            id: id.to_string(),
            title: "Read".to_string(),
            kind: ToolKind::Read,
            status,
            raw_input: Value::Null,
            content: Vec::new(),
            meta: None,
        }
    }

    fn created(meta: &Option<Option<Value>>) -> bool {
        let Some(Some(value)) = meta.clone() else {
            return false;
        };
        value
            .get(MAINFRAME_META_NAMESPACE)
            .and_then(|ns| ns.get("created"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }

    let mut state = SessionState::new();

    // Create: a brand-new message id, alongside a brand-new tool-call id.
    let updates = state.diff(&[msg("m1", "hello"), tool("t1", ToolCallStatus::Pending)]);
    assert_eq!(updates.len(), 2);
    for update in &updates {
        match update {
            SessionUpdate::AgentMessage(upsert) => {
                assert!(created(&upsert.meta), "a message create carries the marker");
            }
            SessionUpdate::ToolCallUpdate(patch) => {
                assert!(created(&patch.meta), "a tool create carries the marker");
            }
            other => panic!("unexpected frame: {other:?}"),
        }
    }

    // Chunk: a pure suffix growth on m1; t1 unchanged emits nothing for it.
    let updates = state.diff(&[
        msg("m1", "hello world"),
        tool("t1", ToolCallStatus::Pending),
    ]);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessageChunk(chunk) = &updates[0] else {
        panic!("expected a chunk");
    };
    assert_eq!(chunk.meta, None, "a chunk never carries the marker");

    // Meta-only: m1's content stays put, its meta changes.
    let updates = state.diff(&[
        EncodedItem::Message {
            id: "m1".to_string(),
            role: ItemRole::Agent,
            content: vec![text_block("hello world")],
            meta: Some(serde_json::json!({ "turnDurationMs": 5 })),
        },
        tool("t1", ToolCallStatus::Pending),
    ]);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessage(upsert) = &updates[0] else {
        panic!("expected a meta-only upsert");
    };
    assert_eq!(upsert.content, None);
    assert!(
        !created(&upsert.meta),
        "a meta-only patch never carries the marker"
    );

    // Full revision: m1's content changes non-append.
    let updates = state.diff(&[msg("m1", "rewritten"), tool("t1", ToolCallStatus::Pending)]);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessage(upsert) = &updates[0] else {
        panic!("expected a full revision");
    };
    assert!(upsert.content.is_some());
    assert!(
        !created(&upsert.meta),
        "a full revision never carries the marker"
    );

    // Tool patch: t1's status changes; m1 unchanged emits nothing for it.
    let updates = state.diff(&[
        msg("m1", "rewritten"),
        tool("t1", ToolCallStatus::InProgress),
    ]);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::ToolCallUpdate(patch) = &updates[0] else {
        panic!("expected a tool patch");
    };
    assert!(
        !created(&patch.meta),
        "a tool patch never carries the marker"
    );

    // Clear: m1 vanishes; t1 stays put, emits nothing.
    let updates = state.diff(&[tool("t1", ToolCallStatus::InProgress)]);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::AgentMessage(upsert) = &updates[0] else {
        panic!("expected a clear");
    };
    assert_eq!(
        upsert.meta,
        Some(None),
        "a clear wires an explicit null, never the marker"
    );
}

// a_tool_call_status_change_patches_only_the_changed_field moved to
// tool_patch/tests.rs (todo #350, plan task 37, R2.13).
