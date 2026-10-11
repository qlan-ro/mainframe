/// Dropping `ItemMeta.streaming` needs no special-casing in the diff engine —
/// it is just another meta change, so it rides whichever shape
/// `content_revision` already picks: a meta-only patch when content is
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

/// A new item's complete first frame (live or replayed) carries
/// `_meta["_mainframe.dev"].created: true`, and nothing else does — not a
/// chunk, a meta-only patch, a full revision, a clear, or a tool-call patch.
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

    // Chunk: a pure suffix growth on m1; unchanged emits nothing for it.
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

    // Tool patch: status changes; m1 unchanged emits nothing for it.
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

    // Clear: m1 vanishes; stays put, emits nothing.
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
// tool_patch/tests.rs.
