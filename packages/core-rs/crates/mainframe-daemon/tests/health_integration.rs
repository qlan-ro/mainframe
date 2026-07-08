//! Integration test for Task 1.3: boots the real axum app on an ephemeral
//! port, issues a raw HTTP GET against `/health`, asserts the JSON shape
//! against `docs/rust-port/fixtures/route.health.json`, then triggers
//! graceful shutdown.
//!
//! Uses a hand-rolled HTTP/1.1 client over `tokio::net::TcpStream` rather
//! than an HTTP client crate: no HTTP client is in the workspace dependency
//! allowlist, and adding one is out of scope for this scaffold (see
//! blockers in the task report).
//!
//! `unwrap`/`expect` are allowed throughout this file: it is entirely test
//! code (integration tests are only ever built under `cargo test`), matching
//! the RUST RULES exemption for `#[cfg(test)]` code.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use mainframe_server::http::{AppState, build_router};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

#[tokio::test]
async fn health_endpoint_serves_expected_shape_and_shuts_down_gracefully() {
    let state = AppState {
        version: "0.0.0-test".to_string(),
        tunnel_url: None,
    };
    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
    });

    let body = http_get(addr, "/health").await;
    let json: serde_json::Value =
        serde_json::from_str(&body).expect("response body must be valid JSON");

    assert_eq!(json["status"], "ok");
    assert_eq!(json["version"], "0.0.0-test");
    assert!(json["tunnelUrl"].is_null());
    // Byte-shape parity with Node's Date.toISOString(): millis precision + `Z`
    // (e.g. 2026-07-08T10:15:30.000Z), never micros or a `+00:00` offset.
    let timestamp = json["timestamp"]
        .as_str()
        .expect("timestamp must be a string");
    assert!(
        timestamp.ends_with('Z'),
        "timestamp must be Z-suffixed UTC: {timestamp}"
    );
    assert_eq!(
        timestamp.len(),
        24,
        "timestamp must be millis-precision ISO-8601: {timestamp}"
    );
    assert_eq!(
        &timestamp[19..20],
        ".",
        "timestamp must have a fractional-second separator: {timestamp}"
    );

    let _ = shutdown_tx.send(());
    server
        .await
        .unwrap()
        .expect("server task must exit cleanly after graceful shutdown");
}

async fn http_get(addr: std::net::SocketAddr, path: &str) -> String {
    let mut stream = TcpStream::connect(addr).await.unwrap();
    let request = format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).await.unwrap();

    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).await.unwrap();
    let raw = String::from_utf8_lossy(&raw);

    let (headers, body) = raw
        .split_once("\r\n\r\n")
        .expect("HTTP response must have a header/body separator");
    assert!(
        headers.starts_with("HTTP/1.1 200"),
        "expected 200 OK, got: {headers}"
    );
    body.to_string()
}
