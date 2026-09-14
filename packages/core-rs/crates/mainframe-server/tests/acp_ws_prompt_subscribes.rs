//! Attach-on-prompt (todo #350, plan task 35, R3.13). Split out of
//! `acp_ws_integration.rs` to keep that file under the 300-line cap. Pins
//! the ordering `dispatch.rs`'s `session/prompt` arm documents: attach runs
//! inline, ahead of the spawn, so a connection observes a session from the
//! moment it sends a prompt rather than from whenever the spawned task gets
//! scheduled. Moving `attach` below the spawn (or behind
//! `dispatch_with_prompt`) must fail this test.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;
use std::time::Duration;

use mainframe_adapter_mock::MockCliAdapter;
use mainframe_chat::chat_surface::ChatSurface;
use serde_json::{Value, json};
use support::barrier_adapter::BarrierAdapter;
use support::facade::spawn_facade_server_with;
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

/// Read events until one satisfies `wanted`, discarding the rest (heartbeats
/// and the real prompt's own frames interleave) — bounded so a genuine hang
/// fails the test instead of hanging the suite. Mirrors `acp_ws_slow_prompt
/// .rs`'s helper of the same name.
async fn read_until(ws: &mut WsClient, wanted: impl Fn(&Value) -> bool) -> Value {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let event = ws.read_event().await;
            if wanted(&event) {
                return event;
            }
        }
    })
    .await
    .expect("wanted frame did not arrive within the timeout")
}

/// The characterization test above proves nothing about ordering relative
/// to the spawn (attach happening late, but before the reply, still passes
/// it). This one does: the adapter's `spawn()` blocks on a barrier, so the
/// prompt cannot possibly have replied, yet a manually pushed chat-surface
/// revision for that session still reaches the socket — attach ran inline,
/// ahead of the spawn, not from wherever the spawned task gets scheduled.
#[tokio::test]
async fn attach_precedes_a_still_blocked_prompts_own_reply() {
    let (adapter, release) = BarrierAdapter::new();
    let facade = spawn_facade_server_with(Arc::new(adapter), 50).await;
    let chat_a = facade.chat_id.clone();
    let chat_b = facade.create_chat().await;

    let mut ws = WsClient::connect(
        facade.server.addr,
        &format!("/acp/{}", facade.profile),
        None,
    )
    .await
    .unwrap();
    ws.send_json(&json!({
        "jsonrpc": "2.0", "id": 0, "method": "initialize",
        "params": { "protocolVersion": 2, "info": { "name": "x", "version": "1" } }
    }))
    .await;
    let init_reply = read_until(&mut ws, |v| v["id"] == json!(0)).await;
    assert!(init_reply.get("result").is_some());

    // Chat A's prompt spawns a session whose adapter blocks indefinitely.
    ws.send_json(&json!({
        "jsonrpc": "2.0", "id": 1, "method": "session/prompt",
        "params": { "sessionId": chat_a, "prompt": [{ "type": "text", "text": "hi" }] }
    }))
    .await;

    // A resume for the UNRELATED chat B, answered on the same socket, can
    // only have been processed after A's prompt frame's own `handle_inbound`
    // call returned (todo #350: `handle_inbound` is awaited inline in the
    // socket `select!`) — a synchronization point standing in for "attach
    // for A has already run", since A's own reply is still barrier-blocked.
    ws.send_json(&json!({
        "jsonrpc": "2.0", "id": 2, "method": "session/resume",
        "params": { "sessionId": chat_b, "cwd": "/tmp" }
    }))
    .await;
    let resume_reply = read_until(&mut ws, |v| v["id"] == json!(2)).await;
    assert!(resume_reply.get("result").is_some());

    // A's prompt is still blocked on the barrier — no reply has been sent —
    // yet a revision pushed straight at the hub for chat A reaches the
    // socket, because the connection subscribed before the spawn, not after.
    facade
        .server
        .ctx
        .facade_hub
        .on_chat_surface_event(revision_event(&chat_a, "t35-marker"));
    let marker = read_until(&mut ws, |v| {
        v["params"]["update"]["content"]
            .to_string()
            .contains("t35-marker")
    })
    .await;
    assert_eq!(marker["params"]["sessionId"], json!(chat_a));

    let _ = release.send(());
    let prompt_reply = read_until(&mut ws, |v| v["id"] == json!(1)).await;
    assert!(prompt_reply.get("result").is_some() || prompt_reply.get("error").is_some());
}
