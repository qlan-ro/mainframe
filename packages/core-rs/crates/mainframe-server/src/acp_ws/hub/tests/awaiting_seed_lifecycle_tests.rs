//! Turn, usage, and retry events raised during the `AwaitingSeed` window.
//! Unlike a revision or a raw frame they carry no content of their own, so
//! they were dropped outright — a turn that ended while a client was
//! resuming left it showing a running spinner until the next turn (todo
//! #350, PR #688 review).

use mainframe_chat::chat_surface::TurnStopReason;
use mainframe_types::adapter::ContextUsage;
use serde_json::json;

use super::*;

/// The replay's own trailing state_update is sampled before the seed lock, so
/// a turn that ended after that sample must win — the drain runs behind the
/// replay, which gives exactly that ordering.
#[tokio::test]
async fn a_turn_that_ends_during_the_await_reaches_the_client_after_the_replay() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    hub.begin_resume(&conn, "chat-1");
    hub.on_chat_surface_event(ChatSurfaceEvent::TurnFinished {
        chat_id: "chat-1".to_string(),
        stop_reason: TurnStopReason::Cancelled,
    });
    assert!(drain(&mut rx).is_empty(), "nothing before the replay");

    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    // `replay_marker` stands in for the replay's trailing state_update, which
    // reports the session as running.
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), replay_marker);

    let frames = drain(&mut rx);
    let states: Vec<_> = frames
        .iter()
        .filter(|f| f["params"]["update"]["sessionUpdate"] == json!("state_update"))
        .collect();
    assert_eq!(states.len(), 2, "the replay's, then the buffered end");
    assert_eq!(states[0]["params"]["update"]["state"], json!("running"));
    assert_eq!(states[1]["params"]["update"]["state"], json!("idle"));
    assert_eq!(
        states[1]["params"]["update"]["stopReason"],
        json!("cancelled")
    );
}

#[tokio::test]
async fn a_turn_that_starts_during_the_await_reaches_the_client_after_the_replay() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    hub.begin_resume(&conn, "chat-1");
    hub.on_chat_surface_event(ChatSurfaceEvent::TurnStarted {
        chat_id: "chat-1".to_string(),
    });

    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), |_c| {});

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 2, "the reply, then the buffered start");
    assert_eq!(frames[1]["params"]["update"]["state"], json!("running"));
}

#[tokio::test]
async fn usage_raised_during_the_await_reaches_the_client_after_the_replay() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    hub.begin_resume(&conn, "chat-1");
    hub.on_chat_surface_event(ChatSurfaceEvent::Usage {
        chat_id: "chat-1".to_string(),
        usage: ContextUsage {
            percentage: 2.5,
            total_tokens: 5_000,
            max_tokens: 200_000,
        },
    });

    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), |_c| {});

    let frames = drain(&mut rx);
    let usage: Vec<_> = frames
        .iter()
        .filter(|f| f["params"]["update"]["sessionUpdate"] == json!("usage_update"))
        .collect();
    assert_eq!(usage.len(), 1, "one usage update: {frames:?}");
    assert_eq!(usage[0]["params"]["update"]["used"], json!(5_000));
}

/// A retry marker emits no frame of its own — it rides the next upsert. The
/// buffered marker must therefore survive the drain and mark the first
/// content frame after the replay, not vanish with the window.
#[tokio::test]
async fn a_retry_raised_during_the_await_marks_the_first_frame_after_the_replay() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    hub.begin_resume(&conn, "chat-1");
    hub.on_chat_surface_event(ChatSurfaceEvent::Retry {
        chat_id: "chat-1".to_string(),
        attempt: 2,
        reason: Some("overloaded_error".to_string()),
    });

    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), |_c| {});
    drain(&mut rx);

    // The retried answer arrives as a new item after the resume.
    hub.on_chat_surface_event(revision("chat-1", "Retried answer"));

    let frames = drain(&mut rx);
    let marked = frames
        .iter()
        .find(|f| f["params"]["update"]["_meta"]["_mainframe.dev"]["attempt"] == json!(2))
        .unwrap_or_else(|| panic!("no frame carried the buffered marker: {frames:?}"));
    assert_eq!(
        marked["params"]["update"]["_meta"]["_mainframe.dev"]["reason"],
        json!("overloaded_error")
    );
}
