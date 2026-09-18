//! `_mainframe.dev/session_detach` (todo #350, plan task 8, D2). Split out of
//! `acp_ws_integration.rs` to keep that file under the 300-line cap.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use mainframe_adapter_mock::MockCliAdapter;
use mainframe_chat::chat_surface::ChatSurface;
use serde_json::json;
use support::facade::revision_event;
use support::{TestServer, WsClient, spawn_test_server};

async fn server_with_mock_adapter() -> TestServer {
    let server = spawn_test_server(None).await;
    server
        .ctx
        .adapter_registry
        .register(std::sync::Arc::new(MockCliAdapter::default()));
    server
}

/// Attaches by prompting (attach-on-send runs even though the prompt itself
/// fails — no `ChatManager` in this harness; it still needs the `initialize`
/// handshake, which gates the attach), detaches, then asserts a further
/// chat-surface revision for that session produces no frame on this socket
/// (D2, R2.3).
#[tokio::test]
async fn session_detach_stops_session_updates() {
    let server = server_with_mock_adapter().await;
    let mut ws = WsClient::connect(server.addr, "/acp/mock-cli", None)
        .await
        .unwrap();

    ws.send_json(&json!({
        "jsonrpc": "2.0",
        "id": 0,
        "method": "initialize",
        "params": {
            "protocolVersion": 2,
            "info": { "name": "mainframe-ui", "version": "2.2.0" }
        }
    }))
    .await;
    let init_reply = ws.read_event().await;
    assert!(init_reply.get("result").is_some());

    ws.send_json(&json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "session/prompt",
        "params": {
            "sessionId": "chat-1",
            "prompt": [{ "type": "text", "text": "hi" }]
        }
    }))
    .await;
    let reply = ws.read_event().await;
    assert_eq!(reply["id"], json!(1));

    // Still attached: a chat-surface revision reaches the socket.
    server
        .ctx
        .facade_hub
        .on_chat_surface_event(revision_event("chat-1", "hello"));
    let frame = ws.read_event().await;
    assert_eq!(frame["method"], json!("session/update"));

    ws.send_json(&json!({
        "jsonrpc": "2.0",
        "method": "_mainframe.dev/session_detach",
        "params": { "sessionId": "chat-1" }
    }))
    .await;

    // Detached: the same kind of revision now reaches nothing.
    server
        .ctx
        .facade_hub
        .on_chat_surface_event(revision_event("chat-1", "hello world"));
    let timed_out = tokio::time::timeout(Duration::from_millis(200), ws.read_event())
        .await
        .is_err();
    assert!(timed_out, "a detached session must produce no more frames");
}
