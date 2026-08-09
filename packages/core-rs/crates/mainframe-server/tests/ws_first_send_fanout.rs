//! Regression coverage for #275: a connection that sends `message.send` for a
//! chat and only then subscribes must still receive that chat's events emitted
//! in between. Drives the real app over the shared WS harness — the same idiom
//! as the broadcast-gating tests in `ws_integration.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use mainframe_types::chat::{ChatMessage, ChatMessageType};
use mainframe_types::events::{ChatNotificationKind, ChatNotificationLevel, DaemonEvent};
use serde_json::json;
use support::{WsClient, spawn_test_server};

const CHAT: &str = "chat-c";
const OTHER: &str = "chat-d";

fn user_message_added(chat_id: &str) -> DaemonEvent {
    DaemonEvent::MessageAdded {
        chat_id: chat_id.into(),
        message: ChatMessage {
            id: "m1".into(),
            chat_id: chat_id.into(),
            r#type: ChatMessageType::User,
            content: vec![],
            timestamp: "2026-08-09T00:00:00.000Z".into(),
            metadata: None,
        },
    }
}

fn display_messages_set(chat_id: &str) -> DaemonEvent {
    DaemonEvent::DisplayMessagesSet {
        chat_id: chat_id.into(),
        messages: vec![],
    }
}

/// A chatId-less event, so the fan-out always delivers it. Broadcast last, the
/// single ordered pump makes its arrival proof that nothing published before it
/// was delivered — a negative assertion with no timing window to lose.
fn sentinel() -> DaemonEvent {
    DaemonEvent::ProcessStopped {
        process_id: "sentinel".into(),
    }
}

async fn send_message_frame(ws: &mut WsClient, chat_id: &str) {
    ws.send_json(&json!({ "type": "message.send", "chatId": chat_id, "content": "hello" }))
        .await;
}

// `message.send` answers nothing when it succeeds, so a test cannot otherwise
// know the daemon has handled it. The connection task handles frames serially,
// so an ack for a LATER frame proves the earlier handler already ran — that is
// what makes publishing on `ctx.broadcast` below race-free. Do not remove.
async fn barrier(ws: &mut WsClient, tag: &str) {
    ws.send_json(&json!({ "type": "subscribe", "chatId": tag }))
        .await;
    loop {
        let ack = ws.wait_for("subscribe:ack").await;
        if ack["chatId"] == tag {
            return;
        }
    }
}

async fn drain_subscribe_frames(ws: &mut WsClient, chat_id: &str) {
    let queued = ws.read_event().await;
    assert_eq!(queued["type"], "message.queued.snapshot");
    assert_eq!(queued["chatId"], chat_id);

    let offer = ws.read_event().await;
    assert_eq!(offer["type"], "worktree.offer.snapshot");
    assert_eq!(offer["chatId"], chat_id);

    let ack = ws.read_event().await;
    assert_eq!(ack["type"], "subscribe:ack");
    assert_eq!(ack["chatId"], chat_id);
}

#[tokio::test]
async fn send_then_subscribe_delivers_the_window_events() {
    let server = spawn_test_server(None).await;
    let mut ws = WsClient::connect(server.addr, "/", None).await.unwrap();
    ws.wait_for("connection.ready").await;

    send_message_frame(&mut ws, CHAT).await;
    barrier(&mut ws, "barrier-1").await;

    let _ = server.ctx.broadcast.send(user_message_added(CHAT));
    let _ = server.ctx.broadcast.send(display_messages_set(CHAT));

    let added = ws.read_event().await;
    assert_eq!(added["type"], "message.added");
    assert_eq!(added["chatId"], CHAT);

    let set = ws.read_event().await;
    assert_eq!(set["type"], "display.messages.set");
    assert_eq!(set["chatId"], CHAT);

    // A later explicit subscribe must remain a no-op insert that still emits
    // both snapshots and the ack.
    ws.send_json(&json!({ "type": "subscribe", "chatId": CHAT }))
        .await;
    drain_subscribe_frames(&mut ws, CHAT).await;
}

#[tokio::test]
async fn subscribe_then_send_delivers_each_event_exactly_once() {
    let server = spawn_test_server(None).await;
    let mut ws = WsClient::connect(server.addr, "/", None).await.unwrap();
    ws.wait_for("connection.ready").await;

    ws.send_json(&json!({ "type": "subscribe", "chatId": CHAT }))
        .await;
    drain_subscribe_frames(&mut ws, CHAT).await;

    send_message_frame(&mut ws, CHAT).await;
    barrier(&mut ws, "barrier-2").await;

    let _ = server.ctx.broadcast.send(user_message_added(CHAT));
    let _ = server.ctx.broadcast.send(display_messages_set(CHAT));
    let _ = server.ctx.broadcast.send(sentinel());

    let added = ws.read_event().await;
    assert_eq!(added["type"], "message.added");
    assert_eq!(added["chatId"], CHAT);

    let set = ws.read_event().await;
    assert_eq!(set["type"], "display.messages.set");
    assert_eq!(set["chatId"], CHAT);

    // A duplicate of either event would arrive ahead of the sentinel.
    let tail = ws.read_event().await;
    assert_eq!(tail["type"], "process.stopped");
}

#[tokio::test]
async fn unsubscribe_releases_membership_gained_by_sending() {
    let server = spawn_test_server(None).await;
    let mut ws = WsClient::connect(server.addr, "/", None).await.unwrap();
    ws.wait_for("connection.ready").await;

    send_message_frame(&mut ws, CHAT).await;
    barrier(&mut ws, "barrier-3a").await;

    let _ = server.ctx.broadcast.send(user_message_added(CHAT));
    let added = ws.read_event().await;
    assert_eq!(added["type"], "message.added");
    assert_eq!(added["chatId"], CHAT);

    ws.send_json(&json!({ "type": "unsubscribe", "chatId": CHAT }))
        .await;
    barrier(&mut ws, "barrier-3b").await;

    let _ = server.ctx.broadcast.send(user_message_added(CHAT));
    let _ = server.ctx.broadcast.send(sentinel());

    let next = ws.read_event().await;
    assert_eq!(next["type"], "process.stopped");
}

#[tokio::test]
async fn sending_to_one_chat_leaks_nothing_from_another() {
    let server = spawn_test_server(None).await;
    let mut ws = WsClient::connect(server.addr, "/", None).await.unwrap();
    ws.wait_for("connection.ready").await;

    send_message_frame(&mut ws, CHAT).await;
    barrier(&mut ws, "barrier-4").await;

    // Broadcast in this order, so the single ordered pump makes a leak
    // observable as an out-of-order first frame.
    let _ = server.ctx.broadcast.send(user_message_added(OTHER));
    let _ = server.ctx.broadcast.send(sentinel());
    let _ = server.ctx.broadcast.send(DaemonEvent::ChatNotification {
        chat_id: OTHER.into(),
        title: "Task Complete".into(),
        body: "done".into(),
        level: ChatNotificationLevel::Success,
        kind: Some(ChatNotificationKind::TaskComplete),
    });

    let first = ws.read_event().await;
    assert_eq!(first["type"], "process.stopped");

    let second = ws.read_event().await;
    assert_eq!(second["type"], "chat.notification");
    assert_eq!(second["chatId"], OTHER);
}
