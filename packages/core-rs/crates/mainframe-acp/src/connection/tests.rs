use super::*;
use crate::prompt::BoxFuture;

fn daemon() -> DaemonInfo {
    DaemonInfo {
        version: "1.0.0".into(),
        heartbeat_interval_ms: 15_000,
    }
}

/// None of these tests exercise the prompt path — `prompt/tests.rs` owns
/// that — so a port that panics on contact proves the dispatcher never
/// touches it for the handshake/error/unknown-method flows.
struct UnusedPort;

impl PromptPort for UnusedPort {
    fn send_prompt<'a>(
        &'a self,
        _session_id: &'a str,
        _text: &'a str,
        _send_meta: mainframe_types::acp::extensions::PromptSendMeta,
    ) -> BoxFuture<'a, Result<crate::prompt::PromptAcceptance, crate::prompt::PromptError>> {
        unreachable!("no test in this module sends a prompt")
    }

    fn cancel<'a>(
        &'a self,
        _session_id: &'a str,
    ) -> BoxFuture<'a, Result<(), crate::prompt::PromptError>> {
        unreachable!("no test in this module cancels")
    }
}

async fn handle(text: &str, negotiated: bool) -> Option<String> {
    handle_frame_with_prompt(text, &daemon(), &UnusedPort, negotiated).await
}

#[tokio::test]
async fn initialize_at_the_pinned_version_returns_a_result_with_capabilities_meta() {
    let text =
        include_str!("../../../mainframe-types/tests/fixtures/acp/jsonrpc-request.initialize.json");
    // Not yet negotiated: `initialize` is the one method exempt from the
    // gate (R3.21) — it is how negotiation happens.
    let reply = handle(text, false).await.expect("initialize must reply");
    let value: Value = serde_json::from_str(&reply).unwrap();

    assert_eq!(value["id"], json!(1));
    assert_eq!(
        value["result"]["protocolVersion"],
        json!(PINNED_PROTOCOL_VERSION)
    );
    assert_eq!(value["result"]["info"]["name"], json!("mainframe-daemon"));
    assert_eq!(
        value["result"]["_meta"]["_mainframe.dev"]["heartbeatIntervalMs"],
        json!(15_000)
    );
}

#[tokio::test]
async fn unsupported_version_gets_the_structured_error_and_a_still_open_connection() {
    let text = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":99,"info":{"name":"x","version":"1"}}}"#;
    let reply = handle(text, false).await.expect("initialize must reply");
    let value: Value = serde_json::from_str(&reply).unwrap();

    assert_eq!(
        value["error"]["code"],
        json!(error_codes::UNSUPPORTED_PROTOCOL_VERSION)
    );
    assert_eq!(
        value["error"]["data"]["supported"],
        json!([PINNED_PROTOCOL_VERSION])
    );

    // The connection stays open: a second, valid frame on the same
    // (simulated) socket still gets a proper reply.
    let ok = r#"{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":2,"info":{"name":"x","version":"1"}}}"#;
    let second = handle(ok, false)
        .await
        .expect("a later frame must still be handled");
    let second_value: Value = serde_json::from_str(&second).unwrap();
    assert!(second_value.get("result").is_some());
}

#[tokio::test]
async fn unknown_method_request_gets_method_not_found() {
    let text = r#"{"jsonrpc":"2.0","id":1,"method":"definitely/not-a-method","params":{}}"#;
    let reply = handle(text, true).await.unwrap();
    let value: Value = serde_json::from_str(&reply).unwrap();
    assert_eq!(value["error"]["code"], json!(error_codes::METHOD_NOT_FOUND));
}

#[tokio::test]
async fn unadvertised_notification_gets_no_reply() {
    let text = r#"{"jsonrpc":"2.0","method":"session/update","params":{}}"#;
    assert_eq!(handle(text, true).await, None);
}

#[tokio::test]
async fn malformed_frame_gets_a_null_id_error_and_the_loop_can_continue() {
    let reply = handle("{not json", true)
        .await
        .expect("malformed frame must reply");
    let value: Value = serde_json::from_str(&reply).unwrap();
    assert_eq!(value["id"], Value::Null);
    assert_eq!(value["error"]["code"], json!(error_codes::PARSE_ERROR));
}

#[tokio::test]
async fn a_session_method_before_initialize_is_refused() {
    let text = r#"{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{"sessionId":"chat_1","prompt":[]}}"#;
    let reply = handle(text, false)
        .await
        .expect("a request before initialize must still get a reply");
    let value: Value = serde_json::from_str(&reply).unwrap();
    assert_eq!(value["id"], json!(1));
    assert_eq!(
        value["error"]["code"],
        json!(error_codes::RESOURCE_NOT_FOUND)
    );
    assert_eq!(value["error"]["message"], json!("initialize required"));
}

#[tokio::test]
async fn a_notification_before_initialize_gets_no_reply() {
    let text = r#"{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"chat_1"}}"#;
    assert_eq!(handle(text, false).await, None);
}

/// The dispatcher is the only place that knows whether an `initialize`
/// succeeded; the socket shell reads that off the outcome rather than
/// re-parsing the reply (todo #350, PR #688 review).
async fn dispatch(text: &str, negotiated: bool) -> DispatchOutcome {
    let frame = rpc::parse_frame(text).expect("fixture frames parse");
    dispatch_with_prompt(frame, &daemon(), &UnusedPort, negotiated).await
}

#[tokio::test]
async fn a_successful_initialize_reports_the_handshake_as_negotiated() {
    let text =
        include_str!("../../../mainframe-types/tests/fixtures/acp/jsonrpc-request.initialize.json");
    assert!(dispatch(text, false).await.negotiated);
}

#[tokio::test]
async fn an_unsupported_version_leaves_the_connection_unnegotiated() {
    let text = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":99,"info":{"name":"x","version":"1"}}}"#;
    assert!(!dispatch(text, false).await.negotiated);
}

#[tokio::test]
async fn a_non_initialize_reply_never_negotiates() {
    let text = r#"{"jsonrpc":"2.0","id":1,"method":"definitely/not-a-method","params":{}}"#;
    assert!(!dispatch(text, true).await.negotiated);
}
