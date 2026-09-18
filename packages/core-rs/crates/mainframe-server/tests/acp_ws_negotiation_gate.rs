//! `initialize` is mandatory before any session method (spec decision 32),
//! and the refusal must leave no trace: a peer that never negotiated — or
//! negotiated an unsupported version — must not end up attached to the
//! session it named, or it would keep receiving that chat's `session/update`
//! fan-out for the rest of the connection (todo #350, PR #688 review).
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

/// Push a revision for `chat-1` and assert this socket stays silent — the
/// connection was refused, so it never subscribed.
async fn assert_not_attached(server: &TestServer, ws: &mut WsClient) {
    server
        .ctx
        .facade_hub
        .on_chat_surface_event(revision_event("chat-1", "hello"));
    let frame = tokio::time::timeout(Duration::from_millis(200), ws.read_event()).await;
    assert!(
        frame.is_err(),
        "a refused connection must not be attached, got {frame:?}"
    );
}

#[tokio::test]
async fn a_prompt_before_initialize_leaves_the_connection_unattached() {
    let server = server_with_mock_adapter().await;
    let mut ws = WsClient::connect(server.addr, "/acp/mock-cli", None)
        .await
        .unwrap();

    ws.send_json(&json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "session/prompt",
        "params": { "sessionId": "chat-1", "prompt": [{ "type": "text", "text": "hi" }] }
    }))
    .await;
    let reply = ws.read_event().await;
    assert_eq!(reply["error"]["message"], json!("initialize required"));

    assert_not_attached(&server, &mut ws).await;
}

#[tokio::test]
async fn a_cancel_before_initialize_leaves_the_connection_unattached() {
    let server = server_with_mock_adapter().await;
    let mut ws = WsClient::connect(server.addr, "/acp/mock-cli", None)
        .await
        .unwrap();

    ws.send_json(&json!({
        "jsonrpc": "2.0",
        "method": "session/cancel",
        "params": { "sessionId": "chat-1" }
    }))
    .await;
    // A cancel is a notification, so it has no reply to wait on. A following
    // request does: `handle_inbound` is awaited inline, so its refusal proves
    // the cancel has already been dispatched.
    ws.send_json(&json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "definitely/not-a-method",
        "params": {}
    }))
    .await;
    let fence = ws.read_event().await;
    assert_eq!(fence["id"], json!(2));

    assert_not_attached(&server, &mut ws).await;
}
