//! WebSocket integration tests — translated from `websocket-auth.test.ts`,
//! `ws-file-subscribe.test.ts`, and `websocket-broadcast-gating.test.ts`, plus
//! the connect/ready/subscribe/ack/file:changed flow the task pins. Real app,
//! real FileWatcherService, real in-memory DB (no mocks).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use mainframe_server::websocket::is_ws_auth_required;
use serde_json::json;
use support::{WsClient, spawn_test_server};

const SECRET: &str = "test-secret";

// ── isWsAuthRequired ─────────────────────────────────────────────────────────

#[test]
fn is_ws_auth_required_matches_ts() {
    assert!(is_ws_auth_required("192.168.1.100", Some(SECRET)));
    assert!(!is_ws_auth_required("127.0.0.1", Some(SECRET)));
    assert!(!is_ws_auth_required("::1", Some(SECRET)));
    assert!(!is_ws_auth_required("::ffff:127.0.0.1", Some(SECRET)));
    assert!(!is_ws_auth_required("192.168.1.100", None));
}

// ── connection lifecycle ─────────────────────────────────────────────────────

#[tokio::test]
async fn connect_receives_connection_ready() {
    let server = spawn_test_server(None).await;
    let mut ws = WsClient::connect(server.addr, "/", None).await.unwrap();
    let ready = ws.read_event().await;
    assert_eq!(ready["type"], "connection.ready");
    assert!(ready["clientId"].as_str().is_some_and(|id| !id.is_empty()));
}

#[tokio::test]
async fn subscribe_emits_empty_snapshot_then_ack() {
    let server = spawn_test_server(None).await;
    let mut ws = WsClient::connect(server.addr, "/", None).await.unwrap();
    ws.wait_for("connection.ready").await;

    ws.send_json(&json!({ "type": "subscribe", "chatId": "c1" }))
        .await;

    // Node sends message.queued.snapshot (refs [] for an empty queue) BEFORE the ack.
    let snapshot = ws.read_event().await;
    assert_eq!(snapshot["type"], "message.queued.snapshot");
    assert_eq!(snapshot["chatId"], "c1");
    assert_eq!(snapshot["refs"], json!([]));

    let ack = ws.read_event().await;
    assert_eq!(ack["type"], "subscribe:ack");
    assert_eq!(ack["chatId"], "c1");
}

// ── file subscriptions ───────────────────────────────────────────────────────

#[tokio::test]
async fn file_subscribe_absolute_acks_and_receives_file_changed() {
    let server = spawn_test_server(None).await;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("hello.ts");
    std::fs::write(&file, "// hello").unwrap();
    let abs = file.to_string_lossy().into_owned();

    let mut ws = WsClient::connect(server.addr, "/", None).await.unwrap();
    ws.wait_for("connection.ready").await;

    ws.send_json(&json!({ "type": "subscribe:file", "path": abs }))
        .await;
    let ack = ws.wait_for("subscribe:file:ack").await;
    assert_eq!(ack["requestedPath"], abs);
    assert!(
        ack["resolvedPath"]
            .as_str()
            .is_some_and(|p| p.ends_with("hello.ts"))
    );

    // Re-write the file on a short cadence until the event arrives. Under the CPU
    // contention of the full parallel workspace run the notify (FSEvents) watcher
    // can register after the first write lands, dropping that single event; a
    // periodic re-write guarantees a change occurs once the backend is live.
    let writer_file = file.clone();
    let writer = tokio::spawn(async move {
        for i in 0.. {
            tokio::time::sleep(Duration::from_millis(200)).await;
            let _ = std::fs::write(&writer_file, format!("// changed {i}"));
        }
    });

    let changed = ws.wait_for("file:changed").await;
    writer.abort();
    assert!(
        changed["path"]
            .as_str()
            .is_some_and(|p| p.ends_with("hello.ts"))
    );
}

#[tokio::test]
async fn file_subscribe_relative_resolves_against_project() {
    let server = spawn_test_server(None).await;
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("hello.ts"), "// hello").unwrap();
    let project_id = server.create_project(&dir.path().to_string_lossy()).await;

    let mut ws = WsClient::connect(server.addr, "/", None).await.unwrap();
    ws.wait_for("connection.ready").await;

    ws.send_json(&json!({
        "type": "subscribe:file",
        "path": "hello.ts",
        "projectId": project_id,
    }))
    .await;
    let ack = ws.wait_for("subscribe:file:ack").await;
    assert_eq!(ack["requestedPath"], "hello.ts");
    assert!(
        ack["resolvedPath"]
            .as_str()
            .is_some_and(|p| p.ends_with("hello.ts"))
    );
}

#[tokio::test]
async fn file_subscribe_relative_without_project_is_rejected() {
    let server = spawn_test_server(None).await;
    let mut ws = WsClient::connect(server.addr, "/", None).await.unwrap();
    ws.wait_for("connection.ready").await;
    ws.send_json(&json!({ "type": "subscribe:file", "path": "hello.ts" }))
        .await;
    // No projectId → no resolution context → no ack.
    ws.assert_absent("subscribe:file:ack", Duration::from_millis(400))
        .await;
}

#[tokio::test]
async fn file_subscribe_rejects_chat_project_ownership_mismatch() {
    let server = spawn_test_server(None).await;
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("hello.ts"), "// hello").unwrap();
    let proj_a = server.create_project(&dir.path().to_string_lossy()).await;
    let proj_b = server
        .create_project(&dir.path().join("b").to_string_lossy())
        .await;
    // A chat that belongs to proj_a.
    let proj_a_for_chat = proj_a.clone();
    let chat_id = server
        .ctx
        .db
        .call(move |db| db.chats.create(&proj_a_for_chat, "claude", None, None))
        .await
        .unwrap()
        .id;

    let mut ws = WsClient::connect(server.addr, "/", None).await.unwrap();
    ws.wait_for("connection.ready").await;

    // Claiming proj_b for a chat owned by proj_a must be rejected.
    ws.send_json(&json!({
        "type": "subscribe:file",
        "path": "hello.ts",
        "projectId": proj_b,
        "chatId": chat_id,
    }))
    .await;
    ws.assert_absent("subscribe:file:ack", Duration::from_millis(400))
        .await;
}

// ── upgrade auth ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn upgrade_rejects_invalid_token_from_non_localhost() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    match WsClient::connect(server.addr, "/?token=garbage", Some("2.2.2.2")).await {
        Err(code) => assert_eq!(code, 401),
        Ok(_) => panic!("upgrade should have been rejected with 401"),
    }
}

#[tokio::test]
async fn upgrade_accepts_valid_token_from_non_localhost() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let token = server.register_device_token(SECRET, "mobile-1").await;
    let mut ws = WsClient::connect(server.addr, &format!("/?token={token}"), Some("2.2.2.2"))
        .await
        .unwrap();
    assert_eq!(ws.read_event().await["type"], "connection.ready");
}

#[tokio::test]
async fn upgrade_allows_localhost_without_token() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    // Loopback peer (no X-Forwarded-For), secret set → still allowed.
    let mut ws = WsClient::connect(server.addr, "/", None).await.unwrap();
    assert_eq!(ws.read_event().await["type"], "connection.ready");
}

// ── broadcast gating ─────────────────────────────────────────────────────────

#[tokio::test]
async fn connection_global_event_reaches_unsubscribed_client() {
    let server = spawn_test_server(None).await;
    let mut ws = WsClient::connect(server.addr, "/", None).await.unwrap();
    ws.wait_for("connection.ready").await;

    // chat.notification is connection-global — delivered even without a subscription.
    let _ = server
        .ctx
        .broadcast
        .send(mainframe_types::events::DaemonEvent::ChatNotification {
            chat_id: "background-chat".into(),
            title: "Task Complete".into(),
            body: "done".into(),
            level: mainframe_types::events::ChatNotificationLevel::Success,
        });
    let event = ws.wait_for("chat.notification").await;
    assert_eq!(event["chatId"], "background-chat");
}

#[tokio::test]
async fn chat_scoped_event_withheld_from_unsubscribed_client() {
    let server = spawn_test_server(None).await;
    let mut ws = WsClient::connect(server.addr, "/", None).await.unwrap();
    ws.wait_for("connection.ready").await;

    // chat.ended carries a chatId and is NOT connection-global → withheld from a
    // client that never subscribed to that chat.
    let _ = server
        .ctx
        .broadcast
        .send(mainframe_types::events::DaemonEvent::ChatEnded {
            chat_id: "background-chat".into(),
        });
    ws.assert_absent("chat.ended", Duration::from_millis(400))
        .await;
}
