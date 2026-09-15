//! What a `session/resume` whose spawned delivery never returned owes the
//! client: a settled promise and a way back onto the stream (todo #350, PR
//! #688 review).

use mainframe_acp::resume::BoxFuture;
use mainframe_types::acp::jsonrpc::RequestId;
use mainframe_types::adapter::ControlRequest;
use mainframe_types::display::DisplayMessage;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::*;
use crate::ctx::AppCtx;

/// A snapshot that panics — the only way to drive the `JoinError` path from
/// outside the spawned task.
struct PanickingPort;

impl ResumePort for PanickingPort {
    fn resume_snapshot<'a>(
        &'a self,
        _session_id: &'a str,
    ) -> BoxFuture<'a, (Vec<DisplayMessage>, Option<ControlRequest>)> {
        Box::pin(async { panic!("resume snapshot blew up") })
    }

    fn is_running(&self, _session_id: &str) -> bool {
        false
    }
}

fn resume_request(id: i64, session_id: &str) -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(RequestId::Number(id)),
        method: "session/resume".into(),
        params: Some(json!({ "sessionId": session_id, "cwd": "/tmp" })),
    }
}

async fn next_frame(rx: &mut mpsc::UnboundedReceiver<String>) -> Value {
    let text = tokio::time::timeout(std::time::Duration::from_secs(5), rx.recv())
        .await
        .expect("a frame within 5s")
        .expect("the connection channel outlives the resume");
    serde_json::from_str(&text).expect("a JSON frame")
}

/// Without a reply the client's promise hangs to its own 30s deadline, and
/// nothing else recovers: heartbeats are connection-level, so the watchdog
/// sees no gap, and a first attach has not attached yet, so the client's gap
/// resume returns early.
#[tokio::test]
async fn a_panicked_resume_settles_the_promise_and_asks_for_a_resync() {
    let ctx = AppCtx::test_ctx();
    let (_client_id, connection, mut rx) = ctx.facade_hub.register("mock-cli".to_string());

    start_resume(
        resume_request(7, "chat-1"),
        &ctx,
        &connection,
        Arc::new(PanickingPort),
    );

    let reply = next_frame(&mut rx).await;
    assert_eq!(reply["id"], json!(7));
    assert_eq!(reply["error"]["code"], json!(-32603));

    let resync = next_frame(&mut rx).await;
    assert_eq!(resync["method"], json!("_mainframe.dev/resync"));
    assert_eq!(resync["params"]["sessionId"], json!("chat-1"));

    assert!(
        !connection.is_attached("chat-1"),
        "a claim that never reached a seeded stream is dropped"
    );
}
/// A panic inside the replay closure lands after `reset_session` seeded the
/// stream. That state is correct and the client is streaming against it, so
/// the failure path must not tear it down.
#[tokio::test]
async fn a_failure_after_the_seed_keeps_the_session_attached() {
    let ctx = AppCtx::test_ctx();
    let (_client_id, connection, mut rx) = ctx.facade_hub.register("mock-cli".to_string());
    ctx.facade_hub.attach(&connection, "chat-1");

    fail_resume(&connection, Some(RequestId::Number(7)), Some("chat-1"));

    assert_eq!(next_frame(&mut rx).await["error"]["code"], json!(-32603));
    assert_eq!(
        next_frame(&mut rx).await["method"],
        json!("_mainframe.dev/resync")
    );
    assert!(connection.is_attached("chat-1"));
}
