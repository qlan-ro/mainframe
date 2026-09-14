//! The `AwaitingSeed` window (T5/T6, R2.9/R2.11): everything raised between
//! `begin_resume` and the snapshot's arrival is buffered, then drained behind
//! the replay — a revision as a diff against the seed, raw frames in arrival
//! order, minus the one gate the replay redelivers itself.

use serde_json::json;

use super::*;

#[tokio::test]
async fn a_revision_during_the_snapshot_await_is_buffered_not_lost() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    // handle_resume attaches before awaiting the snapshot — the connection
    // is not yet seeded, so a racing live revision must be buffered, not
    // dropped and not diffed against nothing.
    hub.begin_resume(&conn, "chat-1");
    hub.on_chat_surface_event(revision("chat-1", "Hello!"));
    assert!(
        drain(&mut rx).is_empty(),
        "a revision during the await must not reach the wire yet"
    );

    // The snapshot the await returned reflects the PRE-race content.
    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), |_c| {});

    let frames = drain(&mut rx);
    assert_eq!(
        frames.len(),
        2,
        "the resume reply, then exactly one catch-up chunk — never a full resend"
    );
    assert_eq!(
        frames[1]["params"]["update"]["sessionUpdate"],
        json!("agent_message_chunk")
    );
    assert_eq!(frames[1]["params"]["update"]["content"]["text"], json!("!"));
}

/// A raw out-of-band frame raised during the snapshot await must not reach
/// the client ahead of the replay it predates — it is buffered like a
/// revision and drained behind it (T6, R2.11).
#[tokio::test]
async fn a_raw_frame_during_the_snapshot_await_is_drained_after_the_replay() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    hub.begin_resume(&conn, "chat-1");
    hub.on_chat_surface_event(ChatSurfaceEvent::Resync {
        chat_id: "chat-1".to_string(),
    });
    assert!(
        drain(&mut rx).is_empty(),
        "a raw frame during the await must not overtake the replay"
    );

    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), replay_marker);

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 3, "reply, replay, then the buffered raw");
    assert_eq!(frames[0]["id"], json!(1));
    assert_eq!(frames[1]["method"], json!("session/update"));
    assert_eq!(frames[2]["method"], json!("_mainframe.dev/resync"));
}

/// A transcript clear buffered across the await is forwarded behind the
/// replay like any other raw frame. The daemon cannot tell whether the wipe
/// predates the snapshot it just replayed, and the client treats the clear as
/// a re-resume trigger — so forwarding costs one redundant resume in the
/// predates case and converges on the wiped state in the other.
#[tokio::test]
async fn a_transcript_clear_during_the_snapshot_await_is_delivered_after_the_replay() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    hub.begin_resume(&conn, "chat-1");
    hub.on_chat_surface_event(ChatSurfaceEvent::TranscriptCleared {
        chat_id: "chat-1".to_string(),
    });
    assert!(
        drain(&mut rx).is_empty(),
        "a clear during the await must not wipe the replay it precedes"
    );

    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), replay_marker);

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 3, "reply, replay, then the clear: {frames:?}");
    assert_eq!(
        frames[2]["method"],
        json!("_mainframe.dev/transcript_cleared")
    );
}

/// Buffered content and a buffered raw drain in that order: the raw (here a
/// gate raise) must not precede the content update it belongs to.
#[tokio::test]
async fn a_buffered_raw_drains_behind_the_buffered_revision() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    hub.begin_resume(&conn, "chat-1");
    hub.on_chat_surface_event(revision("chat-1", "Hello!"));
    hub.on_chat_surface_event(ChatSurfaceEvent::GateRaised {
        chat_id: "chat-1".to_string(),
        request: control_request("req-1"),
    });
    assert!(drain(&mut rx).is_empty());

    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), replay_marker);

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 4, "reply, replay, catch-up, gate: {frames:?}");
    assert_eq!(
        frames[2]["params"]["update"]["sessionUpdate"],
        json!("agent_message_chunk")
    );
    assert_eq!(frames[3]["method"], json!("session/request_permission"));
}

/// A gate raised during the await and still open when the snapshot returns
/// arrives twice on a naive drain: once from the buffer, once from the
/// replay's own `pending_gate` redelivery. The client would then hold two
/// live gates for one decision, only one of which its answer can resolve.
#[tokio::test]
async fn a_gate_the_replay_redelivers_is_not_also_drained_from_the_buffer() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    hub.begin_resume(&conn, "chat-1");
    let control = control_request("req-7");
    hub.on_chat_surface_event(ChatSurfaceEvent::GateRaised {
        chat_id: "chat-1".to_string(),
        request: control.clone(),
    });

    // The snapshot reports the same gate as still pending, so the replay
    // redelivers it inside `reset_session`'s critical section.
    let rpc_id = rpc_id_string(&control.request_id);
    let frame = mainframe_acp::build_permission_request(
        "chat-1",
        mainframe_acp::gate_request_id(&control.request_id),
        &control,
    );
    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    let reply = reply(1);
    let seed = ResumeSeed {
        items: &items,
        reply: &reply,
        redelivered_gate: Some(rpc_id.as_str()),
    };
    hub.reset_session(&conn, "chat-1", seed, |c| {
        c.deliver_gate("chat-1", &control, &frame)
    });

    let frames = drain(&mut rx);
    let gates: Vec<_> = frames
        .iter()
        .filter(|f| f["method"] == json!("session/request_permission"))
        .collect();
    assert_eq!(gates.len(), 1, "one gate, one decision: {frames:?}");
    assert_eq!(gates[0]["id"], json!(rpc_id));
}

/// A gate raised AND resolved inside the await window. `handle_gate_resolved`
/// pushes `_mainframe.dev/gate_resolved` directly (criterion 8: a gate
/// answered on another surface clears immediately), so a drain that still
/// forwards the buffered raise inverts the pair — the client ends the resume
/// holding a live gate the daemon closed before the replay even ran.
#[tokio::test]
async fn a_gate_resolved_during_the_await_is_not_raised_by_the_drain() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    hub.begin_resume(&conn, "chat-1");
    hub.on_chat_surface_event(ChatSurfaceEvent::GateRaised {
        chat_id: "chat-1".to_string(),
        request: control_request("req-3"),
    });
    hub.on_chat_surface_event(ChatSurfaceEvent::GateResolved {
        chat_id: "chat-1".to_string(),
        request_id: "req-3".to_string(),
    });

    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), replay_marker);

    let frames = drain(&mut rx);
    assert_eq!(
        frames
            .iter()
            .filter(|f| f["method"] == json!("_mainframe.dev/gate_resolved"))
            .count(),
        1,
        "the resolution still reaches the client: {frames:?}"
    );
    assert!(
        frames
            .iter()
            .all(|f| f["method"] != json!("session/request_permission")),
        "a resolved gate must not be raised by the drain: {frames:?}"
    );
}

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
    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
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
