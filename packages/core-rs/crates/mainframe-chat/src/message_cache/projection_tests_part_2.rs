#[test]
fn a_tool_timing_completion_records_a_timing_entry() {
    let mut cache = MessageCache::new();
    cache.append_live(
        "c1",
        "session-1",
        ChatMessage {
            id: "a".to_string(),
            chat_id: "c1".to_string(),
            r#type: ChatMessageType::Assistant,
            content: vec![MessageContent::Node(MessageContentNode::ToolUse {
                id: "tool-1".to_string(),
                name: "Bash".to_string(),
                input: Default::default(),
                timing: None,
                command_execution: None,
                parent_tool_use_id: None,
            })],
            timestamp: "t".to_string(),
            metadata: None,
        },
    );
    let recorder = seed(&mut cache, "c1");

    assert!(cache.finish_tool_calls("c1", "session-1"));

    cache.project_display("c1", None, None, || unreachable!());
    let recorded = &recorder.calls()[1];
    assert_eq!(recorded.len(), 1);
    assert!(matches!(&recorded[0], RawChange::Timing(id, _) if id == "tool-1"));
}

#[test]
fn delete_drops_the_slot_so_the_next_projection_is_full() {
    let mut cache = MessageCache::new();
    cache.append("c1", msg("a"));
    let _recorder = seed(&mut cache, "c1");
    cache.delete("c1");
    cache.append("c1", msg("b"));

    assert!(
        is_next_full(&mut cache, "c1"),
        "a dropped slot's next projection is full"
    );
}

#[test]
fn release_drops_the_slot_so_the_next_projection_is_full() {
    let mut cache = MessageCache::new();
    cache.pin("c1");
    cache.append("c1", msg("a"));
    let _recorder = seed(&mut cache, "c1");
    cache.release("c1");
    cache.append("c1", msg("b"));

    assert!(is_next_full(&mut cache, "c1"));
}

#[test]
fn set_drops_the_slot_so_the_next_projection_is_full() {
    let mut cache = MessageCache::new();
    cache.append("c1", msg("a"));
    let _recorder = seed(&mut cache, "c1");
    cache.set("c1", vec![msg("a"), msg("b")]);

    assert!(is_next_full(&mut cache, "c1"));
}

#[test]
fn set_and_snapshot_drops_the_slot_so_the_next_projection_is_full() {
    let mut cache = MessageCache::new();
    cache.append("c1", msg("a"));
    let _recorder = seed(&mut cache, "c1");
    cache.set_and_snapshot("c1", vec![msg("a"), msg("b")]);

    assert!(is_next_full(&mut cache, "c1"));
}

#[test]
fn eviction_drops_the_evicted_chats_slot() {
    let mut cache = MessageCache::new();
    cache.set("a", vec![msg("a-1")]);
    let _recorder = seed(&mut cache, "a");
    for n in 0..50 {
        cache.set(&format!("chat-{n}"), vec![msg("m")]);
    }
    assert!(cache.get("a").is_none(), "the oldest unpinned chat evicts");

    // Re-seed "a" fresh and prove its projection is a full rebuild — the
    // slot cannot have survived its own cache entry's eviction.
    cache.set("a", vec![msg("a-2")]);
    assert!(is_next_full(&mut cache, "a"));
}

#[test]
fn project_display_folds_in_a_pending_delta_from_a_prior_display_snapshot() {
    let mut cache = MessageCache::new();
    cache.append("c1", msg("a"));
    let _recorder = seed(&mut cache, "c1");

    // A resume snapshot read with no raw change in between: its own delta is
    // empty, but stashing it as pending and then folding it into the next
    // live emission must not panic or lose the live delta's own content.
    let raw = cache.get("c1").unwrap().clone();
    let materialized = cache.display_snapshot("c1", &raw, None, None, || unreachable!());
    assert!(materialized.is_empty(), "the recorder emits no containers");

    cache.append("c1", msg("b"));
    let delta = cache.project_display("c1", None, None, || unreachable!());
    assert!(!delta.full);
}

/// follow-up regression: `session/resume` reaches
/// `EventHandler::display_snapshot` -> `MessageCache::display_snapshot`
/// before the chat's first prompt, seeding the real `IncrementalProjector`
/// (not a fake) with an empty `raw` slice. The exact production path —
/// `display_snapshot` on an empty chat, then `append`, then
/// `project_display` — must come back with a non-empty delta, not silently
/// stay empty forever.
#[test]
fn display_snapshot_on_an_empty_chat_then_append_folds_into_project_display() {
    use mainframe_display::incremental::IncrementalProjector;

    let mut cache = MessageCache::new();

    // `session/resume` before the first prompt: an empty chat's history is
    // read as `[]`, seeding the projector with nothing.
    let materialized = cache.display_snapshot("c1", &[], None, None, || {
        Box::new(IncrementalProjector::new())
    });
    assert!(materialized.is_empty());

    cache.append("c1", msg("a"));
    let delta = cache.project_display("c1", None, None, || unreachable!());
    // `project_display` merges this call's delta with the pending `Full`
    // delta `display_snapshot` stashed above (`DisplayDelta::merge`: a
    // pending `full` always wins), so `delta.full` is expected `true` here
    // regardless of the bug — the regression shows up in `len`/`snapshot`
    // instead, carried through from the inner incremental call.
    assert!(delta.full);
    assert_eq!(delta.len, 1, "the first real message must be folded");
    assert_eq!(
        delta.snapshot.materialize().len(),
        1,
        "an empty-groups seed must not leave every later append a no-op"
    );
}

#[test]
fn an_unknown_chat_leaves_no_journal_entry() {
    let mut cache = MessageCache::new();
    assert!(!cache.remove_by_id("ghost", "x"));
    assert!(!cache.move_to_end("ghost", "x"));
    assert!(!cache.strip_queued_and_move_to_end("ghost", "x"));
    assert!(!cache.strip_all_queued("ghost"));
}
