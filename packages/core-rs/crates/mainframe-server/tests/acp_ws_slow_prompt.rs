//! A slow `session/prompt` blocks neither the socket loop (todo #350, plan
//! task 10, R3.6) nor the ordering its own session's `session/cancel`
//! depends on. Split out of `acp_ws_integration.rs` — these are the tests in
//! the group that need the group-1-step-0 `FacadeServer` fixture and a
//! barrier adapter, both sizable enough to justify their own file.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;
use std::time::Duration;

use mainframe_adapter_mock::MockCliAdapter;
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

/// Connect and negotiate against a facade server.
async fn connect(facade: &support::facade::FacadeServer) -> WsClient {
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
    ws
}

/// A `session/cancel` for the SAME session as an in-flight `session/prompt`
/// must not overtake it. Both frames are spawned, so this also pins that two
/// spawned frames for one session acquire its lock in arrival order — the
/// runtime's scheduling must not decide it. The prompt is spawned off the socket loop, so a
/// cancel handled inline would reach `interrupt_chat` while the cold start
/// was still inside `spawn()` — interrupting a turn that has not begun,
/// which is a no-op, and then the turn runs on uncancelled. Both now take
/// the same per-session lock, so the interrupt lands after the prompt is in
/// flight; the adapter records which side of its own spawn each interrupt
/// arrived on.
#[tokio::test]
async fn a_cancel_for_the_same_session_lands_after_its_prompt_is_in_flight() {
    let (adapter, release) = BarrierAdapter::new();
    let interrupts = adapter.interrupt_log();
    let facade = spawn_facade_server_with(Arc::new(adapter), 50).await;
    let chat_a = facade.chat_id.clone();
    let mut ws = connect(&facade).await;

    ws.send_json(&json!({
        "jsonrpc": "2.0", "id": 1, "method": "session/prompt",
        "params": { "sessionId": chat_a, "prompt": [{ "type": "text", "text": "hi" }] }
    }))
    .await;
    // The heartbeat proves the prompt is already in flight and the socket
    // loop free, so the cancel below genuinely races it.
    let _ = read_until(&mut ws, |v| {
        v["method"] == json!("_mainframe.dev/heartbeat")
    })
    .await;

    ws.send_json(&json!({
        "jsonrpc": "2.0", "method": "session/cancel",
        "params": { "sessionId": chat_a }
    }))
    .await;

    // A following request's reply fences the cancel: `handle_inbound` is
    // awaited inline, so by the time this answers, the cancel frame has been
    // dispatched. It must not have reached the session yet — the prompt
    // still holds the lock, blocked in `spawn()`.
    ws.send_json(&json!({
        "jsonrpc": "2.0", "id": 2, "method": "definitely/not-a-method", "params": {}
    }))
    .await;
    let _ = read_until(&mut ws, |v| v["id"] == json!(2)).await;
    assert!(
        interrupts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_empty(),
        "a cancel must not interrupt a turn its own prompt has not started yet"
    );

    let _ = release.send(());
    let prompt_reply = read_until(&mut ws, |v| v["id"] == json!(1)).await;
    assert!(prompt_reply.get("result").is_some() || prompt_reply.get("error").is_some());

    let log = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            {
                let seen = interrupts.lock().unwrap_or_else(|e| e.into_inner());
                if !seen.is_empty() {
                    return seen.clone();
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the cancel must reach the session once the prompt releases it");

    assert_eq!(
        log,
        vec![true],
        "the interrupt must arrive after the prompt's own spawn returned, not during it"
    );
}

#[tokio::test]
async fn a_slow_prompt_does_not_block_other_frames() {
    let (adapter, release) = BarrierAdapter::new();
    let facade = spawn_facade_server_with(Arc::new(adapter), 50).await;
    let chat_a = facade.chat_id.clone();
    let chat_b = facade.create_chat().await;
    let mut ws = connect(&facade).await;

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

/// Read for `ms`, failing if any frame satisfies `unwanted`.
async fn assert_absent(ws: &mut WsClient, ms: u64, unwanted: impl Fn(&Value) -> bool) {
    let found = tokio::time::timeout(Duration::from_millis(ms), async {
        loop {
            let event = ws.read_event().await;
            if unwanted(&event) {
                return event;
            }
        }
    })
    .await;
    assert!(found.is_err(), "unexpected frame: {found:?}");
}

/// `session/resume`'s snapshot is unbounded — a cold chat's `get_messages`
/// loads the whole transcript off disk — so it runs off the socket loop too,
/// behind the same per-session lock as the prompt. Two things follow, and
/// this pins both: the loop keeps answering while the snapshot is in flight,
/// and the resume for a session with a prompt still in flight waits for it
/// rather than replaying a snapshot taken mid-send.
#[tokio::test]
async fn a_resume_waits_for_its_sessions_prompt_while_the_loop_keeps_answering() {
    let (adapter, release) = BarrierAdapter::new();
    let facade = spawn_facade_server_with(Arc::new(adapter), 50).await;
    let chat_a = facade.chat_id.clone();
    let chat_b = facade.create_chat().await;
    let mut ws = connect(&facade).await;

    ws.send_json(&json!({
        "jsonrpc": "2.0", "id": 1, "method": "session/prompt",
        "params": { "sessionId": chat_a, "prompt": [{ "type": "text", "text": "hi" }] }
    }))
    .await;
    ws.send_json(&json!({
        "jsonrpc": "2.0", "id": 3, "method": "session/resume",
        "params": { "sessionId": chat_a, "cwd": "/tmp" }
    }))
    .await;

    // An unrelated chat's resume still answers, so the loop has already
    // dispatched chat A's resume frame — it is waiting on the lock, not
    // queued behind an unread socket.
    ws.send_json(&json!({
        "jsonrpc": "2.0", "id": 2, "method": "session/resume",
        "params": { "sessionId": chat_b, "cwd": "/tmp" }
    }))
    .await;
    let unrelated = read_until(&mut ws, |v| v["id"] == json!(2)).await;
    assert!(unrelated.get("result").is_some());
    assert_absent(&mut ws, 300, |v| v["id"] == json!(3)).await;

    let _ = release.send(());
    let resumed = read_until(&mut ws, |v| v["id"] == json!(3)).await;
    assert!(
        resumed.get("result").is_some(),
        "the resume must complete once the prompt releases the session, got {resumed}"
    );
}

/// The `session/resume` reply precedes every frame of its own replay. The
/// client resets its accumulator when the reply resolves, so a replay frame
/// that arrived first would be wiped — and since T-review the whole burst is
/// queued from a spawned task, which is exactly where that order could slip.
#[tokio::test]
async fn a_resume_reply_precedes_every_frame_of_its_own_replay() {
    let facade = spawn_facade_server_with(Arc::new(MockCliAdapter::default()), 5_000).await;
    let chat = facade.chat_id.clone();
    let mut ws = connect(&facade).await;

    ws.send_json(&json!({
        "jsonrpc": "2.0", "id": 7, "method": "session/resume",
        "params": { "sessionId": chat, "cwd": "/tmp" }
    }))
    .await;

    // Everything the resume produces, in wire order.
    let mut seen: Vec<Value> = Vec::new();
    let reply_at = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let frame = ws.read_event().await;
            let is_reply = frame["id"] == json!(7);
            seen.push(frame);
            if is_reply {
                return seen.len() - 1;
            }
        }
    })
    .await
    .expect("the resume must reply");

    assert_eq!(
        reply_at, 0,
        "no frame may precede the reply on this socket: {seen:?}"
    );
    // And the replay does follow it, so the ordering above is not vacuous.
    let trailing = read_until(&mut ws, |v| v["method"] == json!("session/update")).await;
    assert_eq!(trailing["params"]["sessionId"], json!(chat));
}
