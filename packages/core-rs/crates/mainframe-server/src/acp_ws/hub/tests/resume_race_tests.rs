//! Resume/reset-session cases for `FacadeHub`, including the T5/R2.9
//! race between a live revision and an in-flight snapshot await — split
//! out of `tests.rs` (todo #350, plan task 37, R2.13).

use serde_json::json;

use super::*;

#[tokio::test]
async fn reset_session_seeds_replayed_state_so_live_updates_continue_as_deltas() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.reset_session(&conn, "chat-1", &items, |c| {
        c.send_update(
            "chat-1",
            mainframe_types::acp::update::SessionUpdate::StateUpdate(
                mainframe_types::acp::update::SessionState::Running,
            ),
        );
    });

    // The delivery closure ran inside the reset.
    assert_eq!(drain(&mut rx).len(), 1);

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
    hub.reset_session(&conn, "chat-1", &partial, |_c| {});
    drain(&mut rx);

    // A reconnect resumes again, this time at "Hello" — the seeded state
    // must be replaced wholesale, not merged with the stale "Hel" state.
    let full = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.reset_session(&conn, "chat-1", &full, |c| {
        c.send_json(&json!({"jsonrpc": "2.0", "id": 2, "result": {}}));
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
    hub.reset_session(&conn, "chat-1", &items, |c| {
        c.send_json(&json!({"jsonrpc": "2.0", "id": 1, "result": {}}));
    });

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
