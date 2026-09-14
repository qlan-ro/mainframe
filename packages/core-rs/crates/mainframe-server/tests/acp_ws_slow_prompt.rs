//! The socket loop never blocks on a slow `session/prompt` (todo #350, plan
//! task 10, R3.6). Split out of `acp_ws_integration.rs` — this is the one
//! test in the group that needs the group-1-step-0 `FacadeServer` fixture
//! and a barrier adapter, both sizable enough to justify their own file.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use support::WsClient;
use support::barrier_adapter::BarrierAdapter;
use support::facade::spawn_facade_server_with;

/// Read events until one satisfies `wanted`, discarding the rest (heartbeats
/// interleave with everything else on this socket) — bounded so a genuine
/// hang fails the test instead of hanging the suite.
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

#[tokio::test]
async fn a_slow_prompt_does_not_delay_a_cancel() {
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

    // The heartbeat still arrives — the socket loop is not stuck on A.
    let heartbeat = read_until(&mut ws, |v| {
        v["method"] == json!("_mainframe.dev/heartbeat")
    })
    .await;
    assert_eq!(heartbeat["params"]["sequence"], json!(1));

    // A session/resume for the UNRELATED chat B answers promptly too — Stop
    // and every other session method keep working on every chat while A's
    // cold start is still in flight.
    ws.send_json(&json!({
        "jsonrpc": "2.0", "id": 2, "method": "session/resume",
        "params": { "sessionId": chat_b, "cwd": "/tmp" }
    }))
    .await;
    let resume_reply = read_until(&mut ws, |v| v["id"] == json!(2)).await;
    assert!(
        resume_reply.get("result").is_some(),
        "a session/resume for a different chat must not wait on A's blocked prompt, got {resume_reply}"
    );

    // Releasing the barrier lets A's prompt reply finally land.
    let _ = release.send(());
    let prompt_reply = read_until(&mut ws, |v| v["id"] == json!(1)).await;
    assert!(
        prompt_reply.get("result").is_some() || prompt_reply.get("error").is_some(),
        "A's prompt must still complete once released, got {prompt_reply}"
    );
}
