//! The running `state_update` carries the daemon-recorded turn start
//! (`_meta["_mainframe.dev"].startedAtMs`) — one value for every connection.
use super::*;

const STARTED_AT: i64 = 1_700_000_042_000;

fn turn_started(started_at_ms: Option<i64>) -> ChatSurfaceEvent {
    ChatSurfaceEvent::TurnStarted {
        chat_id: "chat-1".to_string(),
        started_at_ms,
    }
}

#[tokio::test]
async fn a_live_running_frame_carries_the_recorded_start() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    hub.attach(&conn, "chat-1");

    hub.on_chat_surface_event(turn_started(Some(STARTED_AT)));

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 1);
    let update = &frames[0]["params"]["update"];
    assert_eq!(update["state"], json!("running"));
    assert_eq!(
        update["_meta"],
        json!({ "_mainframe.dev": { "startedAtMs": STARTED_AT } })
    );
}

#[tokio::test]
async fn every_attached_connection_receives_the_identical_start() {
    let hub = hub();
    let (_a, first, mut rx_first) = hub.register("mock-cli".to_string());
    let (_b, second, mut rx_second) = hub.register("mock-cli".to_string());
    hub.attach(&first, "chat-1");
    hub.attach(&second, "chat-1");

    hub.on_chat_surface_event(turn_started(Some(STARTED_AT)));

    let first_frames = drain(&mut rx_first);
    let second_frames = drain(&mut rx_second);
    assert_eq!(first_frames, second_frames);
    assert_eq!(
        first_frames[0]["params"]["update"]["_meta"]["_mainframe.dev"]["startedAtMs"],
        json!(STARTED_AT)
    );
}

#[tokio::test]
async fn an_unknown_start_omits_meta_entirely() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    hub.attach(&conn, "chat-1");

    hub.on_chat_surface_event(turn_started(None));

    let frames = drain(&mut rx);
    assert!(frames[0]["params"]["update"].get("_meta").is_none());
}

#[tokio::test]
async fn a_start_buffered_during_a_resume_keeps_its_recorded_value() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    hub.begin_resume(&conn, "chat-1");
    hub.on_chat_surface_event(turn_started(Some(STARTED_AT)));
    let items = mainframe_acp::encoder::encode_containers(&[display_message("m1", "Hello")], None);
    hub.reset_session(&conn, "chat-1", seed(&items, &reply(1)), |_c| {});

    let frames = drain(&mut rx);
    let running = frames.last().expect("the buffered start is delivered");
    assert_eq!(
        running["params"]["update"]["_meta"]["_mainframe.dev"]["startedAtMs"],
        json!(STARTED_AT)
    );
}

#[tokio::test]
async fn a_finished_turn_does_not_leak_its_start_into_the_idle_frame() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    hub.attach(&conn, "chat-1");

    hub.on_chat_surface_event(turn_started(Some(STARTED_AT)));
    hub.on_chat_surface_event(ChatSurfaceEvent::TurnFinished {
        chat_id: "chat-1".to_string(),
        stop_reason: TurnStopReason::Completed,
    });
    hub.on_chat_surface_event(turn_started(Some(STARTED_AT + 60_000)));

    let frames = drain(&mut rx);
    assert!(frames[1]["params"]["update"].get("_meta").is_none());
    assert_eq!(
        frames[2]["params"]["update"]["_meta"]["_mainframe.dev"]["startedAtMs"],
        json!(STARTED_AT + 60_000)
    );
}
