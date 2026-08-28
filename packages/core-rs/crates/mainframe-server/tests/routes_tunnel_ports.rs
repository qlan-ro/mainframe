//! Integration tests for `routes/tunnel_ports.rs` — the per-port quick tunnels
//! behind the localhost chips (#279). The harness drives a stub `cloudflared`
//! that mints `https://abc-def<n>.trycloudflare.com` and logs every spawn, so
//! "reused, not respawned" is asserted on the process count, not just the URL.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use reqwest::StatusCode;
use serde_json::{Value, json};
use support::{
    TestServer, TestServerOptions, TunnelStub, spawn_test_server, spawn_test_server_with,
};

const DAEMON_PORT: u16 = 31415;

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

async fn tunnel_server(stub: TunnelStub) -> TestServer {
    spawn_test_server_with(TestServerOptions {
        auth_secret: None,
        tunnel: Some(stub),
        port: DAEMON_PORT,
        ..TestServerOptions::default()
    })
    .await
}

/// Seed a project + chat; the start route resolves the chat to its project id.
async fn seed_chat(server: &TestServer) -> String {
    server
        .ctx
        .db
        .call(|db| {
            let project = db.projects.create("/tmp/port-tunnels-proj", Some("p"))?;
            let chat = db.chats.create(&project.id, "claude", None, None, None)?;
            Ok(chat.id)
        })
        .await
        .unwrap()
}

async fn post(server: &TestServer, path: &str, body: Value) -> (StatusCode, Value) {
    let res = client()
        .post(server.http_url(path))
        .json(&body)
        .send()
        .await
        .unwrap();
    let status = res.status();
    (status, res.json().await.unwrap())
}

async fn get(server: &TestServer, path: &str) -> (StatusCode, Value) {
    let res = client().get(server.http_url(path)).send().await.unwrap();
    let status = res.status();
    (status, res.json().await.unwrap())
}

#[tokio::test]
async fn start_lists_and_stops_a_port_tunnel() {
    let server = tunnel_server(TunnelStub::Counting).await;
    let chat_id = seed_chat(&server).await;

    let (status, body) = post(
        &server,
        "/api/tunnel/ports/start",
        json!({ "port": 5173, "chatId": chat_id }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({
            "success": true,
            "data": { "url": "https://abc-def1.trycloudflare.com", "port": 5173 },
        })
    );

    let (status, body) = get(&server, "/api/tunnel/ports").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({
            "success": true,
            "data": {
                "tunnels": [{
                    "port": 5173,
                    "url": "https://abc-def1.trycloudflare.com",
                    "state": "ready",
                }],
                "daemonPort": DAEMON_PORT,
            },
        })
    );

    let (status, body) = post(&server, "/api/tunnel/ports/stop", json!({ "port": 5173 })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true }));

    let (_, body) = get(&server, "/api/tunnel/ports").await;
    assert_eq!(body["data"]["tunnels"], json!([]));
}

#[tokio::test]
async fn a_second_start_for_the_same_port_reuses_the_running_tunnel() {
    let server = tunnel_server(TunnelStub::Counting).await;
    let chat_id = seed_chat(&server).await;
    let body = json!({ "port": 5173, "chatId": chat_id });

    let (_, first) = post(&server, "/api/tunnel/ports/start", body.clone()).await;
    let (_, second) = post(&server, "/api/tunnel/ports/start", body).await;

    assert_eq!(first["data"]["url"], "https://abc-def1.trycloudflare.com");
    assert_eq!(second["data"]["url"], "https://abc-def1.trycloudflare.com");
    assert_eq!(server.tunnel_spawn_count(), 1);
}

#[tokio::test]
async fn two_concurrent_starts_spawn_one_tunnel() {
    let server = tunnel_server(TunnelStub::Counting).await;
    let chat_id = seed_chat(&server).await;
    let body = json!({ "port": 5173, "chatId": chat_id });

    let (first, second) = tokio::join!(
        post(&server, "/api/tunnel/ports/start", body.clone()),
        post(&server, "/api/tunnel/ports/start", body),
    );

    assert_eq!(first.1["data"]["url"], "https://abc-def1.trycloudflare.com");
    assert_eq!(
        second.1["data"]["url"],
        "https://abc-def1.trycloudflare.com"
    );
    assert_eq!(server.tunnel_spawn_count(), 1);
}

#[tokio::test]
async fn a_mid_start_tunnel_lists_as_starting_without_a_url() {
    let server = tunnel_server(TunnelStub::Silent).await;
    let chat_id = seed_chat(&server).await;

    let pending = tokio::spawn({
        let url = server.http_url("/api/tunnel/ports/start");
        let body = json!({ "port": 5173, "chatId": chat_id });
        async move { client().post(url).json(&body).send().await }
    });
    tokio::time::sleep(Duration::from_millis(150)).await;

    let (_, body) = get(&server, "/api/tunnel/ports").await;
    assert_eq!(
        body["data"]["tunnels"],
        json!([{ "port": 5173, "url": null, "state": "starting" }])
    );

    pending.abort();
}

#[tokio::test]
async fn stopping_an_unknown_port_succeeds() {
    let server = tunnel_server(TunnelStub::Counting).await;

    let (status, body) = post(&server, "/api/tunnel/ports/stop", json!({ "port": 4321 })).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true }));
}

#[tokio::test]
async fn a_privileged_port_is_rejected() {
    let server = tunnel_server(TunnelStub::Counting).await;
    let chat_id = seed_chat(&server).await;

    for port in [0, 1023] {
        let (status, body) = post(
            &server,
            "/api/tunnel/ports/start",
            json!({ "port": port, "chatId": chat_id }),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "port {port}");
        assert_eq!(
            body,
            json!({ "success": false, "error": "Port must be 1024 or higher" }),
            "port {port}"
        );
    }
    assert_eq!(server.tunnel_spawn_count(), 0);
}

#[tokio::test]
async fn a_port_above_the_u16_range_is_rejected_as_a_malformed_body() {
    let server = tunnel_server(TunnelStub::Counting).await;
    let chat_id = seed_chat(&server).await;

    let (status, body) = post(
        &server,
        "/api/tunnel/ports/start",
        json!({ "port": 70000, "chatId": chat_id }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        json!({ "success": false, "error": "Invalid request body" })
    );
}

#[tokio::test]
async fn tunnelling_the_daemons_own_port_is_rejected() {
    let server = tunnel_server(TunnelStub::Counting).await;
    let chat_id = seed_chat(&server).await;

    let (status, body) = post(
        &server,
        "/api/tunnel/ports/start",
        json!({ "port": DAEMON_PORT, "chatId": chat_id }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        json!({ "success": false, "error": "Cannot tunnel the daemon's own port" })
    );
    assert_eq!(server.tunnel_spawn_count(), 0);
}

#[tokio::test]
async fn an_unknown_chat_is_rejected() {
    let server = tunnel_server(TunnelStub::Counting).await;

    let (status, body) = post(
        &server,
        "/api/tunnel/ports/start",
        json!({ "port": 5173, "chatId": "no-such-chat" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "success": false, "error": "Chat not found" }));
    assert_eq!(server.tunnel_spawn_count(), 0);
}

#[tokio::test]
async fn a_body_missing_the_chat_id_is_rejected() {
    let server = tunnel_server(TunnelStub::Counting).await;

    let (status, body) = post(&server, "/api/tunnel/ports/start", json!({ "port": 5173 })).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        json!({ "success": false, "error": "Invalid request body" })
    );
}

#[tokio::test]
async fn a_stop_body_without_a_port_is_rejected() {
    let server = tunnel_server(TunnelStub::Counting).await;

    let (status, body) = post(&server, "/api/tunnel/ports/stop", json!({})).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        json!({ "success": false, "error": "Invalid request body" })
    );
}

#[tokio::test]
async fn every_route_reports_unavailable_without_a_registry() {
    let server = spawn_test_server(None).await;
    let expected = json!({ "success": false, "error": "Tunnel not available" });

    let (status, body) = get(&server, "/api/tunnel/ports").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, expected);

    let (status, body) = post(
        &server,
        "/api/tunnel/ports/start",
        json!({ "port": 5173, "chatId": "c1" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, expected);

    let (status, body) = post(&server, "/api/tunnel/ports/stop", json!({ "port": 5173 })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, expected);
}
