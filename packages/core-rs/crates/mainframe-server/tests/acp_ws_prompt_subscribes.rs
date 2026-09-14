//! Attach-on-prompt (todo #350, plan task 35, R3.13). Split out of
//! `acp_ws_integration.rs` to keep that file under the 300-line cap. Pins
//! the ordering `dispatch.rs`'s `session/prompt` arm documents: attach runs
//! inline, ahead of the spawn, so a connection observes a session from the
//! moment it sends a prompt rather than from whenever the spawned task gets
//! scheduled. Moving `attach` below the spawn (or behind
//! `dispatch_with_prompt`) must fail this test.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use mainframe_adapter_mock::MockCliAdapter;
use mainframe_chat::chat_surface::ChatSurface;
use serde_json::json;
use support::{TestServer, WsClient, spawn_test_server};

async fn server_with_mock_adapter() -> TestServer {
    let server = spawn_test_server(None).await;
    server
        .ctx
        .adapter_registry
        .register(std::sync::Arc::new(MockCliAdapter::default()));
    server
}

fn revision_event(chat_id: &str, text: &str) -> mainframe_chat::chat_surface::ChatSurfaceEvent {
    mainframe_chat::chat_surface::ChatSurfaceEvent::DisplayRevision {
        chat_id: chat_id.to_string(),
        messages: vec![mainframe_types::display::DisplayMessage {
            id: "m1".to_string(),
            chat_id: chat_id.to_string(),
            r#type: mainframe_types::display::DisplayMessageType::Assistant,
            content: vec![mainframe_types::display::DisplayContent::Leaf(
                mainframe_types::content::LeafContent::Text {
                    text: text.to_string(),
                    parent_tool_use_id: None,
                },
            )],
            timestamp: "2026-09-14T00:00:00.000Z".to_string(),
            metadata: None,
        }],
    }
}

/// Prompts a chat, then pushes one chat-surface revision for that session
/// straight at the hub (no `ChatManager` in this harness — attach-on-send
/// runs even though the prompt itself fails, same as
/// `acp_ws_session_detach.rs`). The connection must have received the
/// subscription by the time the prompt's own reply arrives, and the
/// revision must reach the socket exactly once.
#[tokio::test]
async fn prompting_subscribes_the_connection() {
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

    server
        .ctx
        .facade_hub
        .on_chat_surface_event(revision_event("chat-1", "hello"));
    let frame = ws.read_event().await;
    assert_eq!(frame["method"], json!("session/update"));

    let second = tokio::time::timeout(Duration::from_millis(200), ws.read_event()).await;
    assert!(
        second.is_err(),
        "the revision must reach the socket exactly once, got a second frame: {second:?}"
    );
}
