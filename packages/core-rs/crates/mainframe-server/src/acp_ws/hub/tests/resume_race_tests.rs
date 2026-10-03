//! Seed-and-replay cases for `FacadeHub::reset_session`: what a resume
//! replaces, what it deltas against afterwards, and what it must not
//! resurrect. The buffering window itself lives in `awaiting_seed_tests.rs`.

use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::json;

use super::*;

#[tokio::test]
async fn reset_session_seeds_replayed_state_so_live_updates_continue_as_deltas() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    let items = mainframe_acp::encoder::encode_containers(&[display_message("m1", "Hello")], None);
    hub.begin_resume(&conn, "chat-1");
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), |c| {
        c.send_update(
            "chat-1",
            mainframe_types::acp::update::SessionUpdate::StateUpdate(
                mainframe_types::acp::update::SessionState::Running,
            ),
        );
    });

    // The reply, the replay closure's frame, and the closing replay_complete
    // marker all left inside the reset.
    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 3, "{frames:?}");
    assert_eq!(frames[2]["method"], json!("_mainframe.dev/replay_complete"));

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
    let partial = mainframe_acp::encoder::encode_containers(&[display_message("m1", "Hel")], None);
    hub.begin_resume(&conn, "chat-1");
    hub.reset_session(&conn, "chat-1", seed(&partial, &reply(1)), |_c| {});
    drain(&mut rx);

    // A reconnect resumes again, this time at "Hello" — the seeded state
    // must be replaced wholesale, not merged with the stale "Hel" state.
    let full = mainframe_acp::encoder::encode_containers(&[display_message("m1", "Hello")], None);
    hub.begin_resume(&conn, "chat-1");
    hub.reset_session(&conn, "chat-1", seed(&full, &reply(2)), |c| {
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
    assert_eq!(
        drain(&mut rx).len(),
        3,
        "reply + one replay upsert + replay_complete"
    );

    // A revision carrying exactly what the resume just delivered must not
    // re-send it — the seeded state already matches.
    hub.on_chat_surface_event(revision("chat-1", "Hello"));
    assert!(
        drain(&mut rx).is_empty(),
        "no update: the resume already delivered this content"
    );
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
    let items = mainframe_acp::encoder::encode_containers(&[display_message("m1", "Hello")], None);
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(9)), |_c| {
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
    assert_eq!(
        frames.len(),
        2,
        "the reply, then the closing replay_complete: {frames:?}"
    );
    assert_eq!(frames[0]["id"], json!(9));
    assert_eq!(frames[1]["method"], json!("_mainframe.dev/replay_complete"));

    // And the fan-out stays silent, as it would for any unattached chat.
    hub.on_chat_surface_event(revision("chat-1", "Hello world"));
    assert!(drain(&mut rx).is_empty());
}

/// Spec Decision 38: the session-gone arm sends `replay_complete` too, right
/// after the reply — the invariant ("every successful reply is followed by
/// exactly one marker") holds even when the client's own detach won the race
/// against the resume.
#[tokio::test]
async fn a_reply_to_a_dropped_session_is_followed_by_replay_complete() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    hub.begin_resume(&conn, "chat-1");
    conn.forget_chat("chat-1");

    let items = mainframe_acp::encoder::encode_containers(&[display_message("m1", "Hello")], None);
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(9)), |_c| {});

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 2, "{frames:?}");
    assert_eq!(frames[0]["id"], json!(9));
    assert_eq!(frames[1]["method"], json!("_mainframe.dev/replay_complete"));
    assert!(frames[1]["params"].get("aborted").is_none());
}

/// Spec Decision 38: the full resume order is reply, replay (item creates
/// ending with the turn state), `queue_state`, `replay_complete`, then
/// whatever the `AwaitingSeed` window buffered — the marker sits exactly
/// between the replay's own tail and the catch-up it never overtakes.
#[tokio::test]
async fn replay_complete_follows_queue_state_and_precedes_catch_up() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    // Buffered while the snapshot is in flight.
    hub.begin_resume(&conn, "chat-1");
    hub.on_chat_surface_event(revision("chat-1", "Hello!"));
    assert!(drain(&mut rx).is_empty());

    let items = mainframe_acp::encoder::encode_containers(&[display_message("m1", "Hello")], None);
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), |c| {
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
        c.send_update(
            "chat-1",
            mainframe_types::acp::update::SessionUpdate::StateUpdate(
                mainframe_types::acp::update::SessionState::Idle(
                    mainframe_types::acp::update::IdleStateUpdate {
                        stop_reason: None,
                        meta: None,
                    },
                ),
            ),
        );
        c.send_json(&mainframe_acp::queue_state_notification(
            "chat-1",
            Vec::new(),
        ));
    });

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 6, "{frames:?}");
    assert_eq!(frames[0]["id"], json!(1), "reply");
    assert_eq!(
        frames[1]["params"]["update"]["sessionUpdate"],
        json!("agent_message"),
        "item create"
    );
    assert_eq!(
        frames[2]["params"]["update"]["sessionUpdate"],
        json!("state_update"),
        "the replay's trailing turn state"
    );
    assert_eq!(frames[3]["method"], json!("_mainframe.dev/queue_state"));
    assert_eq!(frames[4]["method"], json!("_mainframe.dev/replay_complete"));
    assert_eq!(
        frames[5]["params"]["update"]["sessionUpdate"],
        json!("agent_message_chunk"),
        "the buffered revision's catch-up frame, behind the marker"
    );
}

/// The replay and the catch-up run behind the reply, so the flag the resume
/// failure path reads must already be set when the replay runs: a panic in
/// there would otherwise answer -32603 for an id that has its result, and
/// drop a Live slot the client is streaming against.
#[tokio::test]
async fn the_reply_is_marked_sent_before_the_replay_runs() {
    let hub = hub();
    let (_id, conn, _rx) = hub.register("mock-cli".to_string());

    let replied = Arc::new(AtomicBool::new(false));
    let seen_by_the_replay = AtomicBool::new(false);
    let items = mainframe_acp::encoder::encode_containers(&[display_message("m1", "Hello")], None);
    hub.begin_resume(&conn, "chat-1");
    hub.reset_session(
        &conn,
        "chat-1",
        seed_with_flag(&items, &reply(1), Arc::clone(&replied)),
        |_c| seen_by_the_replay.store(replied.load(Ordering::SeqCst), Ordering::SeqCst),
    );

    assert!(
        seen_by_the_replay.load(Ordering::SeqCst),
        "the reply left before the replay, so the flag owes it the same order"
    );
}

/// The slot-gone arm replies too — the client's promise settles even when its
/// own detach won the race — so it owes the same flag.
#[tokio::test]
async fn a_reply_to_a_dropped_session_is_marked_sent_too() {
    let hub = hub();
    let (_id, conn, _rx) = hub.register("mock-cli".to_string());

    let replied = Arc::new(AtomicBool::new(false));
    let items = mainframe_acp::encoder::encode_containers(&[display_message("m1", "Hello")], None);
    hub.reset_session(
        &conn,
        "chat-1",
        seed_with_flag(&items, &reply(9), Arc::clone(&replied)),
        |_c| {},
    );

    assert!(replied.load(Ordering::SeqCst), "the reply went out");
}
