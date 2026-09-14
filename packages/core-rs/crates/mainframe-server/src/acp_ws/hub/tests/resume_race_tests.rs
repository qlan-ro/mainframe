//! Resume/reset-session cases for `FacadeHub`, including the T5/R2.9
//! race between a live revision and an in-flight snapshot await — split
//! out of `tests.rs` (todo #350, plan task 37, R2.13).

use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::json;

use super::*;
use crate::acp_ws::facade_conn::FacadeConnection;

/// The `session/resume` reply `reset_session` sends ahead of the replay.
fn reply(id: i64) -> mainframe_types::acp::jsonrpc::JsonRpcResponse {
    mainframe_acp::rpc::success_response(
        Some(mainframe_types::acp::jsonrpc::RequestId::Number(id)),
        json!({}),
    )
}

#[tokio::test]
async fn reset_session_seeds_replayed_state_so_live_updates_continue_as_deltas() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.begin_resume(&conn, "chat-1");
    hub.reset_session(&conn, "chat-1", &items, &reply(1), |c| {
        c.send_update(
            "chat-1",
            mainframe_types::acp::update::SessionUpdate::StateUpdate(
                mainframe_types::acp::update::SessionState::Running,
            ),
        );
    });

    // The reply and the replay closure's frame both left inside the reset.
    assert_eq!(drain(&mut rx).len(), 2);

    // A live revision after the seed emits only the suffix.
    hub.on_chat_surface_event(revision("chat-1", "Hello world"));
    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 1);
    assert_eq!(
        frames[0]["params"]["update"]["sessionUpdate"],
        json!("agent_message_chunk")
    );
    assert_eq!(
        frames[0]["params"]["update"]["content"]["text"],
        json!(" world")
    );
}

#[tokio::test]
async fn a_revision_after_a_resume_deltas_against_the_replay() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    // First resume: seeds "Hel".
    let partial = mainframe_acp::encode(&[display_message("m1", "Hel")]);
    hub.begin_resume(&conn, "chat-1");
    hub.reset_session(&conn, "chat-1", &partial, &reply(1), |_c| {});
    drain(&mut rx);

    // A reconnect resumes again, this time at "Hello" — the seeded state
    // must be replaced wholesale, not merged with the stale "Hel" state.
    let full = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.begin_resume(&conn, "chat-1");
    hub.reset_session(&conn, "chat-1", &full, &reply(2), |c| {
        c.send_update(
            "chat-1",
            mainframe_types::acp::update::SessionUpdate::AgentMessage(
                mainframe_types::acp::update::MessageUpsert {
                    message_id: "m1".to_string(),
                    content: Some(Some(vec![
                        mainframe_types::acp::content::ContentBlock::Text {
                            text: "Hello".to_string(),
                            meta: None,
                        },
                    ])),
                    meta: None,
                },
            ),
        );
    });
    assert_eq!(drain(&mut rx).len(), 2, "reply + one replay upsert");

    // A revision carrying exactly what the resume just delivered must not
    // re-send it — the seeded state already matches.
    hub.on_chat_surface_event(revision("chat-1", "Hello"));
    assert!(
        drain(&mut rx).is_empty(),
        "no update: the resume already delivered this content"
    );
}

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
    hub.reset_session(&conn, "chat-1", &items, &reply(1), |_c| {});

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

/// The client dropped the session (a `_mainframe.dev/session_detach`, or the
/// chat ended) while the resume's snapshot await was still in flight. The
/// completing resume must not resurrect the attachment — the daemon would
/// then encode and push that chat's updates to a connection whose listeners
/// are gone — but the reply must still settle the client's promise.
#[tokio::test]
async fn a_detach_during_the_snapshot_await_is_not_undone_by_the_resume() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    hub.begin_resume(&conn, "chat-1");
    conn.forget_chat("chat-1");

    let replayed = AtomicBool::new(false);
    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.reset_session(&conn, "chat-1", &items, &reply(9), |_c| {
        replayed.store(true, Ordering::SeqCst);
    });

    assert!(
        !conn.is_attached("chat-1"),
        "a session the client dropped must stay dropped"
    );
    assert!(
        !replayed.load(Ordering::SeqCst),
        "no replay for a session nobody is listening to"
    );
    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 1, "the reply alone: {frames:?}");
    assert_eq!(frames[0]["id"], json!(9));

    // And the fan-out stays silent, as it would for any unattached chat.
    hub.on_chat_surface_event(revision("chat-1", "Hello world"));
    assert!(drain(&mut rx).is_empty());
}

/// One `session/update` sent from inside the replay closure, standing in for
/// the transcript a real resume replays.
fn replay_marker(conn: &FacadeConnection) {
    conn.send_update(
        "chat-1",
        mainframe_types::acp::update::SessionUpdate::StateUpdate(
            mainframe_types::acp::update::SessionState::Running,
        ),
    );
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
    hub.reset_session(&conn, "chat-1", &items, &reply(1), replay_marker);

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 3, "reply, replay, then the buffered raw");
    assert_eq!(frames[0]["id"], json!(1));
    assert_eq!(frames[1]["method"], json!("session/update"));
    assert_eq!(frames[2]["method"], json!("_mainframe.dev/resync"));
}

/// A transcript clear buffered across the await is dropped: the snapshot the
/// resume replays already reflects the wipe, so delivering the clear behind
/// the replay would erase the replay itself.
#[tokio::test]
async fn a_transcript_clear_during_the_snapshot_await_is_dropped() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    hub.begin_resume(&conn, "chat-1");
    hub.on_chat_surface_event(ChatSurfaceEvent::TranscriptCleared {
        chat_id: "chat-1".to_string(),
    });

    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.reset_session(&conn, "chat-1", &items, &reply(1), replay_marker);

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 2, "reply and replay only: {frames:?}");
    assert!(
        frames
            .iter()
            .all(|f| f["method"] != json!("_mainframe.dev/transcript_cleared")),
        "the replay already reflects the wipe"
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
    hub.reset_session(&conn, "chat-1", &items, &reply(1), replay_marker);

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 4, "reply, replay, catch-up, gate: {frames:?}");
    assert_eq!(
        frames[2]["params"]["update"]["sessionUpdate"],
        json!("agent_message_chunk")
    );
    assert_eq!(frames[3]["method"], json!("session/request_permission"));
}
