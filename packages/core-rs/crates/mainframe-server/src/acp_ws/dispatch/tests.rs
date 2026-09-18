//! What a spawned session method owes the client when its dispatch never
//! returns (todo #350, PR #688 review).

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
