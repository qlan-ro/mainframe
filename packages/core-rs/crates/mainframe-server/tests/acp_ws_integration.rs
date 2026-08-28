//! `/acp/{adapter-profile}` integration tests (todo #350, plan tasks 8-9):
//! auth parity with `/`, profile validation, the `initialize` handshake's
//! both branches (criterion 1: supported version succeeds, unsupported gets a
//! structured error with the connection still open), the heartbeat cadence,
//! and the facade connection registry (criterion 11's daemon half).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use mainframe_adapter_mock::MockCliAdapter;
use serde_json::json;
use support::{TestServer, TestServerOptions, WsClient, spawn_test_server, spawn_test_server_with};

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
        "method": "definitely/not-a-method",
        "params": {}
    }))
    .await;
    let reply = ws.read_event().await;
    assert_eq!(reply["error"]["code"], json!(-32601));
}

/// `session/prompt` is wired to the prompt port, not method-not-found. This
/// harness runs with no `ChatManager`, so the port answers with the
/// structured session-unavailable error (-32002) — the same code a prompt to
/// a dead chat gets — never -32601.
#[tokio::test]
async fn session_prompt_reaches_the_prompt_port() {
    let server = server_with_mock_adapter().await;
    let mut ws = WsClient::connect(server.addr, "/acp/mock-cli", None)
        .await
        .unwrap();

    ws.send_json(&json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "session/prompt",
        "params": {
            "sessionId": "no-such-chat",
            "prompt": [{ "type": "text", "text": "hi" }]
        }
    }))
    .await;
    let reply = ws.read_event().await;
    assert_eq!(reply["id"], json!(1));
    assert_eq!(reply["error"]["code"], json!(-32002));
}

/// `session/resume` is wired: with no `ChatManager` the snapshot is empty, so
/// the reply is a plain success (an empty replay), never -32601.
#[tokio::test]
async fn session_resume_reaches_the_resume_port() {
    let server = server_with_mock_adapter().await;
    let mut ws = WsClient::connect(server.addr, "/acp/mock-cli", None)
        .await
        .unwrap();

    ws.send_json(&json!({
        "jsonrpc": "2.0",
        "id": 7,
        "method": "session/resume",
        "params": { "sessionId": "no-such-chat", "cwd": "/tmp" }
    }))
    .await;
    let reply = ws.read_event().await;
    assert_eq!(reply["id"], json!(7));
    assert!(
        reply.get("result").is_some(),
        "resume must succeed with an empty replay, got {reply}"
    );
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

// ── heartbeat ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn heartbeat_arrives_periodically_at_the_configured_cadence() {
    let server = spawn_test_server_with(TestServerOptions {
        facade_heartbeat_interval_ms: 50,
        ..TestServerOptions::default()
    })
    .await;
    server
        .ctx
        .adapter_registry
        .register(std::sync::Arc::new(MockCliAdapter::default()));
    let mut ws = WsClient::connect(server.addr, "/acp/mock-cli", None)
        .await
        .unwrap();

    let first = tokio::time::timeout(Duration::from_secs(2), ws.read_event())
        .await
        .expect("first heartbeat must arrive within the timeout");
    assert_eq!(first["method"], json!("_mainframe.dev/heartbeat"));
    assert_eq!(first["params"]["sequence"], json!(1));

    let second = tokio::time::timeout(Duration::from_secs(2), ws.read_event())
        .await
        .expect("second heartbeat must arrive within the timeout");
    assert_eq!(second["params"]["sequence"], json!(2));
}

// ── connection registry ──────────────────────────────────────────────────────

#[tokio::test]
async fn connecting_registers_a_facade_client_and_disconnecting_unregisters_it() {
    let server = server_with_mock_adapter().await;
    assert_eq!(server.ctx.facade_hub.connection_count(), 0);

    let ws = WsClient::connect(server.addr, "/acp/mock-cli", None)
        .await
        .unwrap();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    while server.ctx.facade_hub.connection_count() == 0 && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(server.ctx.facade_hub.connection_count(), 1);

    drop(ws);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    while server.ctx.facade_hub.connection_count() != 0 && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(server.ctx.facade_hub.connection_count(), 0);
}
