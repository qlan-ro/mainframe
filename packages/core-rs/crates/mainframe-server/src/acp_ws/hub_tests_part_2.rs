fn assert_next_turn_streaming(kind: mainframe_types::display::StreamingLeafKind, item_id: &str) {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".into());
    hub.attach(&conn, "chat-1");
    hub.on_chat_surface_event(revision("chat-1", "completed answer"));
    let previous = drain(&mut rx);
    assert_eq!(previous.len(), 1);
    assert!(previous[0]["params"]["update"]["_meta"]["_mainframe.dev"]["streaming"].is_null());
    hub.on_chat_surface_event(ChatSurfaceEvent::TurnStarted {
        chat_id: "chat-1".into(),
    });
    hub.on_chat_surface_event(revision("chat-1", "completed answer"));
    let waiting = drain(&mut rx);
    assert_eq!(waiting.len(), 1);
    assert_eq!(
        waiting[0]["params"]["update"]["sessionUpdate"],
        "state_update"
    );
    assert_eq!(waiting[0]["params"]["update"]["state"], "running");

    hub.on_chat_surface_event(next_turn_revision(kind, true));
    let partial = drain(&mut rx);
    assert_eq!(partial.len(), 1);
    assert_eq!(partial[0]["params"]["update"]["messageId"], item_id);
    assert_eq!(
        partial[0]["params"]["update"]["_meta"]["_mainframe.dev"]["streaming"],
        true
    );
    hub.on_chat_surface_event(next_turn_revision(kind, false));
    let committed = drain(&mut rx);
    assert_eq!(committed.len(), 1);
    assert_eq!(committed[0]["params"]["update"]["messageId"], item_id);
    assert_eq!(
        committed[0]["params"]["update"]["_meta"]["_mainframe.dev"],
        json!({
            "containerId": "next", "timestamp": "2026-08-28T00:00:00.000Z",
        })
    );
}

#[tokio::test]
async fn a_new_turn_does_not_remark_the_previous_answer_and_commit_drops_the_overlay() {
    use mainframe_types::display::StreamingLeafKind;
    for (kind, item_id) in [
        (StreamingLeafKind::Text, "next"),
        (StreamingLeafKind::Thinking, "next-thought"),
    ] {
        assert_next_turn_streaming(kind, item_id);
    }
}
