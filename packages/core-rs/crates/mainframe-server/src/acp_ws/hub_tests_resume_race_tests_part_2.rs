// ── Replay result previews ───────────────────────────────────────────────────

fn tool_message(id: &str, result: &str) -> DisplayMessage {
    use mainframe_types::display::{DisplayNode, ToolCallResult, ToolCategory};
    DisplayMessage {
        id: id.to_string(),
        chat_id: "chat-1".to_string(),
        r#type: DisplayMessageType::Assistant,
        content: vec![DisplayContent::Node(DisplayNode::ToolCall {
            timing: None,
            command_execution: None,
            id: format!("{id}-tool"),
            name: "Read".to_string(),
            input: Default::default(),
            category: ToolCategory::Default,
            result: Some(ToolCallResult {
                content: result.to_string(),
                is_error: false,
                structured_patch: None,
                original_file: None,
                modified_file: None,
                truncated: None,
                full_bytes: None,
                ask_user_question: None,
                images: Vec::new(),
            }),
            parent_tool_use_id: None,
        })],
        timestamp: "2026-08-28T00:00:00.000Z".to_string(),
        metadata: None,
    }
}

#[tokio::test]
async fn a_live_re_encode_after_a_previewed_seed_emits_nothing_for_the_previewed_item() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    let big = "r".repeat(mainframe_acp::PREVIEW_BYTES * 2);
    let messages: Vec<DisplayMessage> = (0..mainframe_acp::FULL_RESULT_CONTAINERS + 1)
        .map(|i| tool_message(&format!("m{i}"), &big))
        .collect();
    let containers = mainframe_acp::encoder::encode_containers(&messages, None);
    let previews = mainframe_acp::preview_ids(&containers);
    assert_eq!(previews, HashSet::from(["m0-tool".to_string()]));

    hub.begin_resume(&conn, "chat-1");
    let reply = reply(1);
    let seed = ResumeSeed {
        containers: &containers,
        reply: &reply,
        replied: Arc::new(AtomicBool::new(false)),
        completed: Arc::new(AtomicBool::new(false)),
        redelivered_gate: None,
        preview_ids: &previews,
    };
    hub.reset_session(&conn, "chat-1", seed, |_| {});
    drain(&mut rx);

    // The projection re-emits the same chat in full: the previewed item must
    // compare equal to its seeded preview, so nothing goes out.
    hub.on_chat_surface_event(ChatSurfaceEvent::DisplayRevision {
        chat_id: "chat-1".to_string(),
        delta: full_delta(messages.clone()),
        streaming: None,
    });
    assert!(drain(&mut rx).is_empty());

    // A real change to the previewed result arrives trimmed, never in full.
    let mut changed = messages.clone();
    changed[0] = tool_message("m0", &format!("CHANGED{big}"));
    hub.on_chat_surface_event(ChatSurfaceEvent::DisplayRevision {
        chat_id: "chat-1".to_string(),
        delta: full_delta(changed),
        streaming: None,
    });
    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 1, "{frames:?}");
    let text = frames[0]["params"]["update"]["content"][0]["content"]["text"]
        .as_str()
        .unwrap();
    assert_eq!(text.len(), mainframe_acp::PREVIEW_BYTES);
    assert_eq!(
        frames[0]["params"]["update"]["content"][0]["content"]["_meta"]["_mainframe.dev"]["truncated"],
        json!(true)
    );
}
