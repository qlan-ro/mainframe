//! End-to-end `FacadeHub` revision-cursor cases (todo #377): recording with
//! nobody attached, the `_mainframe.dev/cursor` notification an opted-in
//! connection gets (and a non-opted one does not), epoch resets from
//! chat-surface events, and `ChatEnded` dropping the log. Shares
//! `tests.rs`'s fixtures via `use super::*`.

use mainframe_chat::chat_surface::CompactionPhase;

use super::*;

fn cursor_notes(frames: &[Value]) -> Vec<&Value> {
    frames
        .iter()
        .filter(|f| f["method"] == json!("_mainframe.dev/cursor"))
        .collect()
}

/// A log exists exactly the way an opted-in resume would create one —
/// through `revision_log_for_resume`, not by poking the registry.
fn logged_chat(hub: &FacadeHub, chat_id: &str) {
    hub.revision_log_for_resume(true, chat_id);
}

#[tokio::test]
async fn a_display_revision_is_recorded_even_with_nobody_attached() {
    let hub = hub();
    // No connection at all is attached to "chat-1" — only a log exists.
    logged_chat(&hub, "chat-1");

    hub.on_chat_surface_event(revision("chat-1", "Hello"));

    let boundary = hub
        .revision_boundary("chat-1")
        .expect("the log is still there");
    assert_eq!(
        boundary.revision, 1,
        "recording must not depend on a connection being attached"
    );
}

#[tokio::test]
async fn an_opted_in_connection_gets_a_cursor_notification_after_its_content() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    conn.mark_revision_cursors_opted_in();
    hub.attach(&conn, "chat-1");
    logged_chat(&hub, "chat-1");

    hub.on_chat_surface_event(revision("chat-1", "Hello"));

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 2, "{frames:?}");
    assert_eq!(
        frames[0]["params"]["update"]["sessionUpdate"],
        json!("agent_message")
    );
    assert_eq!(frames[1]["method"], json!("_mainframe.dev/cursor"));
    assert_eq!(frames[1]["params"]["revision"], json!(1));
}

#[tokio::test]
async fn a_non_opted_connection_gets_no_cursor_notification_even_with_a_log() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    hub.attach(&conn, "chat-1");
    logged_chat(&hub, "chat-1");

    hub.on_chat_surface_event(revision("chat-1", "Hello"));

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 1, "content only, no cursor frame: {frames:?}");
    assert!(cursor_notes(&frames).is_empty());
}

/// A revision racing `begin_resume`→`reset_session`: catch-up delivers the
/// buffered op, carrying its own cursor — never behind the resume's
/// boundary, since `RevisionLog::record`'s counter only moves forward.
#[tokio::test]
async fn a_revision_racing_the_resume_window_arrives_as_catch_up_with_its_cursor() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    conn.mark_revision_cursors_opted_in();

    hub.begin_resume(&conn, "chat-1")
        .expect("opted-in connection gets a log");
    let boundary_before = hub.revision_boundary("chat-1").unwrap();

    // Races the snapshot await: buffered, not lost.
    hub.on_chat_surface_event(revision("chat-1", "Hello"));
    assert!(drain(&mut rx).is_empty());

    let items = mainframe_acp::encoder::encode_containers(&[], None);
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), |_c| {});

    let frames = drain(&mut rx);
    let notes = cursor_notes(&frames);
    assert_eq!(notes.len(), 1, "{frames:?}");
    let catch_up_revision = notes[0]["params"]["revision"].as_u64().unwrap();
    assert!(
        catch_up_revision > boundary_before.revision,
        "the buffered op's cursor must be past the resume's own boundary"
    );
}

/// The companion to the test above, at the reply itself rather than
/// `revision_boundary()`: the `reply`'s own `cursor` meta — the boundary
/// `begin_resume` returns alongside the log, which `dispatch_resume` must
/// carry untouched into the reply (todo #377 review, must-fix #1/#3) — has
/// to stay strictly below the catch-up frame's cursor, never the log's
/// post-race boundary. A reply built from a fresh `log.boundary()` read
/// after the race (the bug) would equal the catch-up cursor instead of
/// being behind it.
#[tokio::test]
async fn the_reply_cursor_itself_never_catches_up_to_a_revision_racing_the_resume_window() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    conn.mark_revision_cursors_opted_in();

    let (_log, captured_boundary) = hub
        .begin_resume(&conn, "chat-1")
        .expect("opted-in connection gets a log");

    // Races the snapshot await: buffered, not lost.
    hub.on_chat_surface_event(revision("chat-1", "Hello"));
    assert!(drain(&mut rx).is_empty());

    // The reply a real `dispatch_resume` would produce for this boundary —
    // built the same way `resume::success_response` shapes it, so this
    // exercises the actual wire field the client reads.
    let reply_with_captured_cursor = mainframe_acp::rpc::success_response(
        Some(mainframe_types::acp::jsonrpc::RequestId::Number(1)),
        json!({
            "_meta": {
                "_mainframe.dev": {
                    "itemCount": 0,
                    "cursor": captured_boundary,
                }
            }
        }),
    );

    let items = mainframe_acp::encoder::encode_containers(&[], None);
    hub.reset_session(
        &conn,
        "chat-1",
        seed(&items, &reply_with_captured_cursor),
        |_c| {},
    );

    let frames = drain(&mut rx);
    let reply_frame = frames
        .iter()
        .find(|f| f["id"] == json!(1))
        .expect("the reply frame");
    let reply_cursor_revision =
        reply_frame["result"]["_meta"]["_mainframe.dev"]["cursor"]["revision"]
            .as_u64()
            .unwrap();
    assert_eq!(
        reply_cursor_revision, captured_boundary.revision,
        "the reply must carry exactly the pre-snapshot captured boundary"
    );

    let notes = cursor_notes(&frames);
    assert_eq!(notes.len(), 1, "{frames:?}");
    let catch_up_revision = notes[0]["params"]["revision"].as_u64().unwrap();
    assert!(
        reply_cursor_revision < catch_up_revision,
        "the reply's own cursor must never acknowledge the racing revision \
         that only arrives as catch-up"
    );
}

#[tokio::test]
async fn transcript_cleared_rotates_the_epoch() {
    let hub = hub();
    logged_chat(&hub, "chat-1");
    let before = hub.revision_boundary("chat-1").unwrap().epoch;

    hub.on_chat_surface_event(ChatSurfaceEvent::TranscriptCleared {
        chat_id: "chat-1".to_string(),
    });

    let after = hub.revision_boundary("chat-1").unwrap().epoch;
    assert_ne!(before, after);
}

#[tokio::test]
async fn resync_rotates_the_epoch() {
    let hub = hub();
    logged_chat(&hub, "chat-1");
    let before = hub.revision_boundary("chat-1").unwrap().epoch;

    hub.on_chat_surface_event(ChatSurfaceEvent::Resync {
        chat_id: "chat-1".to_string(),
    });

    let after = hub.revision_boundary("chat-1").unwrap().epoch;
    assert_ne!(before, after);
}

#[tokio::test]
async fn a_finished_compaction_rotates_the_epoch_but_a_started_one_does_not() {
    let hub = hub();
    logged_chat(&hub, "chat-1");
    let original = hub.revision_boundary("chat-1").unwrap().epoch;

    hub.on_chat_surface_event(ChatSurfaceEvent::Compaction {
        chat_id: "chat-1".to_string(),
        phase: CompactionPhase::Started,
    });
    let after_started = hub.revision_boundary("chat-1").unwrap().epoch;
    assert_eq!(original, after_started, "started must not rotate it");

    hub.on_chat_surface_event(ChatSurfaceEvent::Compaction {
        chat_id: "chat-1".to_string(),
        phase: CompactionPhase::Done,
    });
    let after_done = hub.revision_boundary("chat-1").unwrap().epoch;
    assert_ne!(original, after_done, "done must rotate it");
}

#[tokio::test]
async fn chat_ended_drops_the_log() {
    let hub = hub();
    logged_chat(&hub, "chat-1");

    hub.on_chat_surface_event(ChatSurfaceEvent::ChatEnded {
        chat_id: "chat-1".to_string(),
    });

    assert!(hub.revision_boundary("chat-1").is_none());
}
