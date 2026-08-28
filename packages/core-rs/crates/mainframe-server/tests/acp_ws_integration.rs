//! `/acp/{adapter-profile}` integration tests (todo #350, plan task 8): auth
//! parity with `/`, profile validation, and the `initialize` handshake's both
//! branches (criterion 1: supported version succeeds, unsupported gets a
//! structured error with the connection still open). Heartbeat + the facade
//! connection registry are task 9.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use mainframe_adapter_mock::MockCliAdapter;
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

fn initialize_request(id: i64, protocol_version: i64) -> serde_json::Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "initialize",
        "params": {
            "protocolVersion": protocol_version,
            "info": { "name": "mainframe-ui", "version": "2.2.0" }
        }
    })
}

// ── profile validation ──────────────────────────────────────────────────────

#[tokio::test]
async fn unknown_adapter_profile_is_rejected_with_404() {
    let server = spawn_test_server(None).await;
    match WsClient::connect(server.addr, "/acp/no-such-adapter", None).await {
        Err(code) => assert_eq!(code, 404),
        Ok(_) => panic!("upgrade to an unregistered profile should have been rejected"),
    }
}

#[tokio::test]
async fn registered_adapter_profile_upgrades() {
    let server = server_with_mock_adapter().await;
    WsClient::connect(server.addr, "/acp/mock-cli", None)
        .await
        .expect("upgrade to a registered profile must succeed");
}

// ── upgrade auth (parity with `/`) ──────────────────────────────────────────

#[tokio::test]
async fn upgrade_rejects_invalid_token_from_non_localhost() {
    let server = spawn_test_server(Some("test-secret".to_string())).await;
    server
        .ctx
        .adapter_registry
        .register(std::sync::Arc::new(MockCliAdapter::default()));
    match WsClient::connect(server.addr, "/acp/mock-cli?token=garbage", Some("2.2.2.2")).await {
        Err(code) => assert_eq!(code, 401),
        Ok(_) => panic!("upgrade should have been rejected with 401"),
    }
}

// ── initialize handshake ─────────────────────────────────────────────────────

#[tokio::test]
async fn initialize_at_the_pinned_version_returns_a_result_with_capabilities() {
    let server = server_with_mock_adapter().await;
    let mut ws = WsClient::connect(server.addr, "/acp/mock-cli", None)
        .await
        .unwrap();

    ws.send_json(&initialize_request(1, 2)).await;
    let reply = ws.read_event().await;

    assert_eq!(reply["id"], json!(1));
    assert_eq!(reply["result"]["protocolVersion"], json!(2));
    assert_eq!(reply["result"]["info"]["name"], json!("mainframe-daemon"));
    assert_eq!(
        reply["result"]["_meta"]["_mainframe.dev"]["heartbeatIntervalMs"],
        json!(mainframe_acp::DEFAULT_HEARTBEAT_INTERVAL_MS)
    );
}

#[tokio::test]
async fn unsupported_version_gets_a_structured_error_and_the_connection_stays_open() {
    let server = server_with_mock_adapter().await;
    let mut ws = WsClient::connect(server.addr, "/acp/mock-cli", None)
        .await
        .unwrap();

    ws.send_json(&initialize_request(1, 99)).await;
    let error_reply = ws.read_event().await;
    assert_eq!(error_reply["error"]["code"], json!(-32001));
    assert_eq!(error_reply["error"]["data"]["supported"], json!([2]));

    // The socket is still open: a follow-up frame on the SAME connection gets
    // a proper reply rather than silence or a closed socket.
    ws.send_json(&initialize_request(2, 2)).await;
    let ok_reply = ws.read_event().await;
    assert!(ok_reply.get("result").is_some());
}

#[tokio::test]
async fn unknown_method_gets_method_not_found() {
    let server = server_with_mock_adapter().await;
    let mut ws = WsClient::connect(server.addr, "/acp/mock-cli", None)
        .await
        .unwrap();

    ws.send_json(&json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "session/prompt",
        "params": {}
    }))
    .await;
    let reply = ws.read_event().await;
    assert_eq!(reply["error"]["code"], json!(-32601));
}

#[tokio::test]
async fn malformed_frame_gets_a_parse_error_and_the_connection_stays_open() {
    let server = server_with_mock_adapter().await;
    let mut ws = WsClient::connect(server.addr, "/acp/mock-cli", None)
        .await
        .unwrap();

    ws.send_text("{not json").await;
    let reply = ws.read_event().await;
    assert_eq!(reply["error"]["code"], json!(-32700));

    ws.send_json(&initialize_request(1, 2)).await;
    let ok_reply = ws.read_event().await;
    assert!(ok_reply.get("result").is_some());
}
