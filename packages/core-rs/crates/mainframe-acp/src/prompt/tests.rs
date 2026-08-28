use std::sync::Mutex;

use mainframe_types::acp::jsonrpc::{JsonRpcNotification, JsonRpcOutcome, RequestId, error_codes};

use super::*;
use crate::connection::{DaemonInfo, handle_frame_with_prompt};

#[derive(Default)]
struct FakePort {
    sent: Mutex<Vec<(String, String)>>,
    cancelled: Mutex<Vec<String>>,
    /// When set, `send_prompt` returns this queued position instead of `None`.
    queue_next_at: Option<i64>,
    /// When set, every call fails with this message (dead/degraded session).
    fails_with: Option<String>,
}

impl PromptPort for FakePort {
    fn send_prompt<'a>(
        &'a self,
        session_id: &'a str,
        text: &'a str,
    ) -> BoxFuture<'a, Result<PromptAcceptance, PromptError>> {
        Box::pin(async move {
            if let Some(message) = &self.fails_with {
                return Err(PromptError {
                    message: message.clone(),
                });
            }
            self.sent
                .lock()
                .unwrap()
                .push((session_id.to_string(), text.to_string()));
            Ok(PromptAcceptance {
                queued_position: self.queue_next_at,
            })
        })
    }

    fn cancel<'a>(&'a self, session_id: &'a str) -> BoxFuture<'a, Result<(), PromptError>> {
        Box::pin(async move {
            if let Some(message) = &self.fails_with {
                return Err(PromptError {
                    message: message.clone(),
                });
            }
            self.cancelled.lock().unwrap().push(session_id.to_string());
            Ok(())
        })
    }
}

fn prompt_request(session_id: &str, text: &str) -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: Some(RequestId::Number(1)),
        method: "session/prompt".to_string(),
        params: Some(json!({
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": text }],
        })),
    }
}

#[tokio::test]
async fn an_immediate_prompt_accepts_with_no_meta_no_queue_frame_family() {
    let port = FakePort::default();
    let response = dispatch_prompt(prompt_request("chat_1", "run the tests"), &port).await;

    let JsonRpcOutcome::Result { result } = response.outcome else {
        panic!("expected a result, got {:?}", response.outcome);
    };
    // Criterion 5: no `queue.*` frame family — acceptance is this same
    // PromptResponse shape, undecorated when the turn starts immediately.
    assert_eq!(result, json!({}));
    assert_eq!(
        *port.sent.lock().unwrap(),
        vec![("chat_1".to_string(), "run the tests".to_string())]
    );
}

#[tokio::test]
async fn a_queued_prompt_accepts_with_the_mainframe_extension_meta() {
    let port = FakePort {
        queue_next_at: Some(2),
        ..Default::default()
    };
    let response = dispatch_prompt(prompt_request("chat_1", "hi"), &port).await;

    let JsonRpcOutcome::Result { result } = response.outcome else {
        panic!("expected a result, got {:?}", response.outcome);
    };
    assert_eq!(result["_meta"]["_mainframe.dev"]["position"], json!(2));
}

#[tokio::test]
async fn a_dead_session_prompt_gets_a_structured_error() {
    let port = FakePort {
        fails_with: Some("chat not running".to_string()),
        ..Default::default()
    };
    let response = dispatch_prompt(prompt_request("chat_1", "hi"), &port).await;

    let JsonRpcOutcome::Error { error } = response.outcome else {
        panic!("expected an error, got {:?}", response.outcome);
    };
    assert_eq!(error.code, error_codes::RESOURCE_NOT_FOUND);
    assert!(error.message.contains("chat not running"));
}

#[tokio::test]
async fn malformed_prompt_params_get_invalid_params_without_touching_the_port() {
    let port = FakePort::default();
    let request = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: Some(RequestId::Number(1)),
        method: "session/prompt".to_string(),
        params: Some(json!({ "notSessionId": true })),
    };
    let response = dispatch_prompt(request, &port).await;

    let JsonRpcOutcome::Error { error } = response.outcome else {
        panic!("expected an error, got {:?}", response.outcome);
    };
    assert_eq!(error.code, error_codes::INVALID_PARAMS);
    assert!(port.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn session_cancel_notification_routes_to_the_port() {
    let port = FakePort::default();
    dispatch_cancel(Some(json!({ "sessionId": "chat_1" })), &port).await;

    assert_eq!(*port.cancelled.lock().unwrap(), vec!["chat_1".to_string()]);
}

#[tokio::test]
async fn a_malformed_cancel_notification_is_dropped_silently() {
    let port = FakePort::default();
    dispatch_cancel(Some(json!({ "nope": true })), &port).await;
    dispatch_cancel(None, &port).await;

    assert!(port.cancelled.lock().unwrap().is_empty());
}

// ── handle_frame_with_prompt routing ────────────────────────────────────────

fn daemon() -> DaemonInfo {
    DaemonInfo {
        version: "1.0.0".to_string(),
        heartbeat_interval_ms: 15_000,
    }
}

#[tokio::test]
async fn handle_frame_with_prompt_routes_session_prompt_through_the_port() {
    let port = FakePort::default();
    let text = r#"{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{"sessionId":"chat_1","prompt":[{"type":"text","text":"hi"}]}}"#;

    let reply = handle_frame_with_prompt(text, &daemon(), &port)
        .await
        .expect("session/prompt must reply");
    let value: Value = serde_json::from_str(&reply).unwrap();
    assert!(value.get("result").is_some());
    assert_eq!(
        *port.sent.lock().unwrap(),
        vec![("chat_1".to_string(), "hi".to_string())]
    );
}

#[tokio::test]
async fn handle_frame_with_prompt_routes_session_cancel_through_the_port_with_no_reply() {
    let port = FakePort::default();
    let text = r#"{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"chat_1"}}"#;

    let reply = handle_frame_with_prompt(text, &daemon(), &port).await;
    assert_eq!(reply, None, "a notification never gets a reply");
    assert_eq!(*port.cancelled.lock().unwrap(), vec!["chat_1".to_string()]);
}

#[tokio::test]
async fn handle_frame_with_prompt_still_serves_initialize_synchronously() {
    let port = FakePort::default();
    let text =
        include_str!("../../../mainframe-types/tests/fixtures/acp/jsonrpc-request.initialize.json");

    let reply = handle_frame_with_prompt(text, &daemon(), &port)
        .await
        .expect("initialize must still reply");
    let value: Value = serde_json::from_str(&reply).unwrap();
    assert!(value.get("result").is_some());
}

#[tokio::test]
async fn handle_frame_with_prompt_ignores_unrelated_notifications() {
    let port = FakePort::default();
    let note = JsonRpcNotification {
        jsonrpc: "2.0".to_string(),
        method: "session/update".to_string(),
        params: None,
    };
    let text = serde_json::to_string(&note).unwrap();

    assert_eq!(
        handle_frame_with_prompt(&text, &daemon(), &port).await,
        None
    );
}
