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

    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.begin_resume(&conn, "chat-1");
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), |c| {
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
    hub.reset_session(&conn, "chat-1", seed(&partial, &reply(1)), |_c| {});
    drain(&mut rx);

    // A reconnect resumes again, this time at "Hello" — the seeded state
    // must be replaced wholesale, not merged with the stale "Hel" state.
    let full = mainframe_acp::encode(&[display_message("m1", "Hello")]);
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
    assert_eq!(drain(&mut rx).len(), 2, "reply + one replay upsert");

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
    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
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
    assert_eq!(frames.len(), 1, "the reply alone: {frames:?}");
    assert_eq!(frames[0]["id"], json!(9));

    // And the fan-out stays silent, as it would for any unattached chat.
    hub.on_chat_surface_event(revision("chat-1", "Hello world"));
    assert!(drain(&mut rx).is_empty());
}
