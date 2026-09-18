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

/// A resume that completes: an empty transcript still seeds the stream and
/// sends its reply.
struct EmptyPort;

impl ResumePort for EmptyPort {
    fn resume_snapshot<'a>(
        &'a self,
        _session_id: &'a str,
    ) -> BoxFuture<'a, (Vec<DisplayMessage>, Option<ControlRequest>)> {
        Box::pin(async { (Vec::new(), None) })
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

/// Every frame the connection has to send, up to a quiet window — a resume
/// failure's frames all leave in one burst once the panic unwinds.
async fn drain(rx: &mut mpsc::UnboundedReceiver<String>) -> Vec<Value> {
    let mut frames = Vec::new();
    while let Ok(Some(text)) =
        tokio::time::timeout(std::time::Duration::from_millis(250), rx.recv()).await
    {
        frames.push(serde_json::from_str(&text).expect("a JSON frame"));
    }
    frames
}

fn resyncs(frames: &[Value]) -> usize {
    frames
        .iter()
        .filter(|frame| frame["method"] == json!("_mainframe.dev/resync"))
        .count()
}

fn internal_errors(frames: &[Value]) -> usize {
    frames
        .iter()
        .filter(|frame| frame["error"]["code"] == json!(-32603))
        .count()
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
/// `reset_session` sends the success reply as it seeds, so a failure after
/// that point — a panic in the replay closure — owes the client nothing but a
/// way back: the seeded stream is correct and the client is reading it. The
/// slot is no evidence the reply went out, though: `session_detach` and
/// `ChatEnded` drop it without the per-session lock, so a teardown racing the
/// panic would make a map read answer -32603 for an id that already got a
/// result.
#[tokio::test]
async fn a_replied_resume_failure_keeps_the_session_and_sends_only_a_resync() {
    let ctx = AppCtx::test_ctx();
    let (_client_id, connection, mut rx) = ctx.facade_hub.register("mock-cli".to_string());
    ctx.facade_hub.attach(&connection, "chat-1");

    fail_resume(ResumeFailure {
        connection: &connection,
        request_id: Some(RequestId::Number(7)),
        session_id: Some("chat-1"),
        replied: true,
        cause: "the delivery task panicked".to_string(),
    });

    let resync = next_frame(&mut rx).await;
    assert_eq!(resync["method"], json!("_mainframe.dev/resync"));
    assert!(resync.get("id").is_none(), "a notification answers nobody");
    assert!(
        rx.try_recv().is_err(),
        "the reply already went out; a second response for that id could only be dropped"
    );
    assert!(
        connection.is_attached("chat-1"),
        "the seeded stream is the one the client is reading"
    );
}

/// The client answers every resync with a full reattach, so a resume that
/// panics repeatably on the same stored transcript would loop at round-trip
/// speed, reloading the transcript every iteration.
#[tokio::test]
async fn a_repeatedly_failing_resume_asks_for_one_resync_only() {
    let ctx = AppCtx::test_ctx();
    let (_client_id, connection, mut rx) = ctx.facade_hub.register("mock-cli".to_string());

    for id in [1, 2] {
        start_resume(
            resume_request(id, "chat-1"),
            &ctx,
            &connection,
            Arc::new(PanickingPort),
        );
    }
    let frames = drain(&mut rx).await;

    assert_eq!(resyncs(&frames), 1, "only the first failure asks again");
    assert_eq!(internal_errors(&frames), 2, "both promises still settle");
}

#[tokio::test]
async fn a_resume_that_succeeds_clears_the_failure_count() {
    let ctx = AppCtx::test_ctx();
    let (_client_id, connection, mut rx) = ctx.facade_hub.register("mock-cli".to_string());

    start_resume(
        resume_request(1, "chat-1"),
        &ctx,
        &connection,
        Arc::new(PanickingPort),
    );
    assert_eq!(resyncs(&drain(&mut rx).await), 1);

    start_resume(
        resume_request(2, "chat-1"),
        &ctx,
        &connection,
        Arc::new(EmptyPort),
    );
    drain(&mut rx).await;

    start_resume(
        resume_request(3, "chat-1"),
        &ctx,
        &connection,
        Arc::new(PanickingPort),
    );

    assert_eq!(
        resyncs(&drain(&mut rx).await),
        1,
        "a resume that worked since means this failure is not the loop"
    );
}
