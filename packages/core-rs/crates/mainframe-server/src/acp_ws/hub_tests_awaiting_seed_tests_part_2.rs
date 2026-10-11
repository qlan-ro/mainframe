/// The snapshot reports a gate as open, but it was answered on another
/// surface while that snapshot was in flight. The buffered raise is already
/// handled; this is the same inversion through the replay's own redelivery,
/// which the connection's pending map cannot catch — redelivery is what
/// registers the gate in the first place. The registry is the only witness.
#[tokio::test]
async fn a_gate_resolved_since_the_snapshot_is_not_redelivered_by_the_replay() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    hub.begin_resume(&conn, "chat-1");
    let control = control_request("req-5");
    hub.on_chat_surface_event(ChatSurfaceEvent::GateRaised {
        chat_id: "chat-1".to_string(),
        request: control.clone(),
    });
    hub.on_chat_surface_event(ChatSurfaceEvent::GateResolved {
        chat_id: "chat-1".to_string(),
        request_id: control.request_id.clone(),
    });

    // The snapshot predates the resolution, so the replay still carries the
    // gate as pending.
    let frame = mainframe_acp::build_permission_request(
        "chat-1",
        mainframe_acp::gate_request_id(&control.request_id),
        &control,
    );
    let items = mainframe_acp::encoder::encode_containers(&[display_message("m1", "Hello")], None);
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), |c| {
        hub.redeliver_gate(c, "chat-1", &control, &frame);
    });

    let frames = drain(&mut rx);
    assert!(
        frames
            .iter()
            .all(|f| f["method"] != json!("session/request_permission")),
        "a gate resolved since the snapshot must not be redelivered: {frames:?}"
    );
    assert_eq!(
        frames
            .iter()
            .filter(|f| f["method"] == json!("_mainframe.dev/gate_resolved"))
            .count(),
        1,
        "the resolution the client already got is the last word: {frames:?}"
    );
}

/// Two resumes for one session can be in flight at once — the client's gap
/// watchdog racing a reattach. The second claim must not discard what the
/// first one's window already buffered.
#[tokio::test]
async fn a_second_begin_resume_keeps_what_the_first_buffered() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    hub.begin_resume(&conn, "chat-1");
    hub.on_chat_surface_event(ChatSurfaceEvent::Resync {
        chat_id: "chat-1".to_string(),
    });
    hub.begin_resume(&conn, "chat-1");

    let items = mainframe_acp::encoder::encode_containers(&[display_message("m1", "Hello")], None);
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), replay_marker);

    let frames = drain(&mut rx);
    assert!(
        frames
            .iter()
            .any(|f| f["method"] == json!("_mainframe.dev/resync")),
        "the second claim must not drop the first's buffer: {frames:?}"
    );
}
