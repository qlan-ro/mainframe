//! What a spawned session method owes the client when its dispatch never
//! returns.

use mainframe_acp::prompt::{BoxFuture, PromptAcceptance, PromptError};
use mainframe_types::acp::extensions::PromptSendMeta;
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, RequestId};
use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::*;

/// A prompt that panics on contact — the only way to drive the `JoinError`
/// path from outside the spawned task.
struct PanickingPromptPort;

impl PromptPort for PanickingPromptPort {
    fn send_prompt<'a>(
        &'a self,
        _session_id: &'a str,
        _text: &'a str,
        _send_meta: PromptSendMeta,
    ) -> BoxFuture<'a, Result<PromptAcceptance, PromptError>> {
        Box::pin(async { panic!("send_prompt blew up") })
    }

    fn cancel<'a>(&'a self, _session_id: &'a str) -> BoxFuture<'a, Result<(), PromptError>> {
        Box::pin(async { Ok(()) })
    }
}

fn daemon() -> DaemonInfo {
    DaemonInfo {
        version: "1.0.0".into(),
        heartbeat_interval_ms: 15_000,
    }
}

fn prompt_request(id: i64, session_id: &str) -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(RequestId::Number(id)),
        method: "session/prompt".into(),
        params: Some(json!({
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": "hello" }],
        })),
    }
}

async fn next_frame(rx: &mut mpsc::UnboundedReceiver<String>) -> Value {
    let text = tokio::time::timeout(std::time::Duration::from_secs(5), rx.recv())
        .await
        .expect("a frame within 5s")
        .expect("the connection channel outlives the dispatch");
    serde_json::from_str(&text).expect("a JSON frame")
}

/// `session/prompt` is a request: without a reply its promise never settles,
/// and no heartbeat or watchdog covers a single unanswered call.
#[tokio::test]
async fn a_panicked_prompt_dispatch_still_answers_the_request() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let connection = Arc::new(FacadeConnection::new("mock-cli".to_string(), tx));
    connection.mark_negotiated();

    spawn_session_method(
        InboundFrame::Request(prompt_request(9, "chat-1")),
        Some("chat-1".to_string()),
        daemon(),
        Arc::new(PanickingPromptPort),
        Arc::clone(&connection),
    );

    let reply = next_frame(&mut rx).await;

    assert_eq!(reply["id"], json!(9));
    assert_eq!(reply["error"]["code"], json!(-32603));
}

fn initialize_request(id: i64, opt_in: Option<bool>) -> JsonRpcRequest {
    let mut params = json!({
        "protocolVersion": mainframe_types::acp::session::PINNED_PROTOCOL_VERSION,
        "info": { "name": "mainframe-ui", "title": "Mainframe", "version": "2.2.0" },
        "capabilities": {},
    });
    if let Some(opt_in) = opt_in {
        params["_meta"] = json!({ "_mainframe.dev": { "revisionCursors": opt_in } });
    }
    JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(RequestId::Number(id)),
        method: "initialize".into(),
        params: Some(params),
    }
}

/// A successful `initialize` whose `_meta` opts in also marks the connection
/// — the same call that marks it negotiated.
#[tokio::test]
async fn a_successful_initialize_with_the_opt_in_meta_marks_the_connection() {
    let ctx = AppCtx::test_ctx();
    let (_id, connection, _rx) = ctx.facade_hub.register("mock-cli".to_string());

    handle_inbound(
        &serde_json::to_string(&initialize_request(1, Some(true))).unwrap(),
        &daemon(),
        &ctx,
        &connection,
    )
    .await;

    assert!(connection.is_negotiated());
    assert!(connection.is_revision_cursors_opted_in());
}

/// An `initialize` with no opt-in key negotiates normally but does not mark
/// revision-cursor support — byte-identical to a client that predates
/// revision cursors.
#[tokio::test]
async fn an_initialize_without_the_opt_in_meta_leaves_revision_cursors_off() {
    let ctx = AppCtx::test_ctx();
    let (_id, connection, _rx) = ctx.facade_hub.register("mock-cli".to_string());

    handle_inbound(
        &serde_json::to_string(&initialize_request(1, None)).unwrap(),
        &daemon(),
        &ctx,
        &connection,
    )
    .await;

    assert!(connection.is_negotiated());
    assert!(!connection.is_revision_cursors_opted_in());
}

/// `_meta.revisionCursors: false` is explicit opt-out, same as absent.
#[tokio::test]
async fn an_explicit_false_opt_in_leaves_revision_cursors_off() {
    let ctx = AppCtx::test_ctx();
    let (_id, connection, _rx) = ctx.facade_hub.register("mock-cli".to_string());

    handle_inbound(
        &serde_json::to_string(&initialize_request(1, Some(false))).unwrap(),
        &daemon(),
        &ctx,
        &connection,
    )
    .await;

    assert!(!connection.is_revision_cursors_opted_in());
}

/// An unsupported protocol version fails to negotiate — the opt-in must not
/// be marked for a handshake that did not succeed, even if the client asked.
#[tokio::test]
async fn a_failed_initialize_does_not_mark_the_opt_in() {
    let ctx = AppCtx::test_ctx();
    let (_id, connection, _rx) = ctx.facade_hub.register("mock-cli".to_string());
    let mut request = initialize_request(1, Some(true));
    if let Some(params) = request.params.as_mut() {
        params["protocolVersion"] = json!(999_999);
    }

    handle_inbound(
        &serde_json::to_string(&request).unwrap(),
        &daemon(),
        &ctx,
        &connection,
    )
    .await;

    assert!(!connection.is_negotiated());
    assert!(!connection.is_revision_cursors_opted_in());
}
