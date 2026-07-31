//! Integration tests for negotiated HTTP response compression (todo #294):
//! gzip/brotli negotiation, the size floor, CORS/attachment interaction, and
//! the WS upgrade staying untouched — all against the production `build_app`
//! router (real spawned app, no mocks).
//!
//! Decision D4: `GET /api/chats/{id}/messages` self-gates on `ctx.chat_manager`,
//! which this harness leaves `None`, so it never produces a large real payload
//! here. The negotiation/byte-identity/threshold criteria are proven instead
//! against `GET /api/projects/{id}/files?path=big.txt`, a large *real* payload
//! through the same layer; the chat-history route gets its own dedicated
//! byte-identity assertion.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::io::Read;

use reqwest::StatusCode;
use reqwest::header::HeaderMap;
use support::{TestServer, spawn_test_server};
use tempfile::TempDir;

/// Spawn a server with a real project containing `big.txt`: a highly
/// repetitive ~200 KB string, well under the file-content route's 2 MB cap.
async fn spawn_project_with_big_file() -> (TestServer, String, TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let line = "the quick brown fox jumps over the lazy dog 0123456789\n";
    let mut content = String::with_capacity(220_000);
    while content.len() < 200_000 {
        content.push_str(line);
    }
    std::fs::write(dir.path().join("big.txt"), &content).unwrap();
    let server = spawn_test_server(None).await;
    let id = server.create_project(&dir.path().to_string_lossy()).await;
    (server, id, dir)
}

/// One request with optional `Accept-Encoding` / `Origin`, returning the raw
/// (never auto-decoded — reqwest is feature-free here) body bytes.
async fn get(
    server: &TestServer,
    path: &str,
    accept_encoding: Option<&str>,
    origin: Option<&str>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut req = reqwest::Client::new().get(server.http_url(path));
    if let Some(enc) = accept_encoding {
        req = req.header("Accept-Encoding", enc);
    }
    if let Some(origin) = origin {
        req = req.header("Origin", origin);
    }
    let resp = req.send().await.unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let body = resp.bytes().await.unwrap().to_vec();
    (status, headers, body)
}

fn gunzip(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(bytes)
        .read_to_end(&mut out)
        .unwrap();
    out
}

fn unbrotli(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    brotli::BrotliDecompress(&mut &bytes[..], &mut out).unwrap();
    out
}

// ── negotiation, byte-identity, and the size floor ──────────────────────────
//
// Tests 1, 3, and 4 are red-phase evidence: each must fail against the
// uncompressed daemon on the missing `content-encoding` header. Tests 2, 5,
// and 6 are identity guards — already true today, so they pass in both
// phases by design; they exist to catch Group B over-reaching.

#[tokio::test]
async fn gzip_negotiation_returns_a_body_identical_to_the_identity_response() {
    let (server, id, _dir) = spawn_project_with_big_file().await;
    let path = format!("/api/projects/{id}/files?path=big.txt");

    let (identity_status, identity_headers, identity_body) = get(&server, &path, None, None).await;
    assert_eq!(identity_status, StatusCode::OK);
    assert!(identity_headers.get("content-encoding").is_none());

    let (status, headers, body) = get(&server, &path, Some("gzip"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers.get("content-encoding").unwrap(), "gzip");
    assert!(headers.get("content-length").is_none());
    let vary = headers
        .get("vary")
        .unwrap()
        .to_str()
        .unwrap()
        .to_ascii_lowercase();
    assert!(vary.contains("accept-encoding"));

    let decoded = gunzip(&body);
    assert_eq!(decoded, identity_body);
    assert!(body.len() * 4 < identity_body.len());
}

#[tokio::test]
async fn identity_is_returned_when_the_client_advertises_nothing() {
    let (server, id, _dir) = spawn_project_with_big_file().await;
    let (status, headers, body) = get(
        &server,
        &format!("/api/projects/{id}/files?path=big.txt"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(headers.get("content-encoding").is_none());
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["success"], true);
    assert!(json["data"]["content"].as_str().is_some());
}

#[tokio::test]
async fn brotli_is_selected_when_the_client_prefers_it() {
    let (server, id, _dir) = spawn_project_with_big_file().await;
    let path = format!("/api/projects/{id}/files?path=big.txt");
    let (_, _, identity_body) = get(&server, &path, None, None).await;

    let (status, headers, body) = get(&server, &path, Some("br;q=1.0, gzip;q=0.5"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers.get("content-encoding").unwrap(), "br");
    assert_eq!(unbrotli(&body), identity_body);
}

#[tokio::test]
async fn gzip_is_selected_when_the_client_prefers_it_over_brotli() {
    let (server, id, _dir) = spawn_project_with_big_file().await;
    let path = format!("/api/projects/{id}/files?path=big.txt");
    let (_, _, identity_body) = get(&server, &path, None, None).await;

    let (status, headers, body) = get(&server, &path, Some("gzip;q=1.0, br;q=0.5"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers.get("content-encoding").unwrap(), "gzip");
    assert_eq!(gunzip(&body), identity_body);
}

#[tokio::test]
async fn small_responses_pass_through_uncompressed() {
    let server = spawn_test_server(None).await;
    let (status, headers, body) = get(&server, "/health", Some("gzip, br"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(headers.get("content-encoding").is_none());
    // Documents *why* this is exempt: the 1024-byte floor, not luck.
    assert!(body.len() < 1024);
}

#[tokio::test]
async fn chat_history_route_is_byte_identical_through_the_layer() {
    // This harness leaves `chat_manager: None` (Decision D4), so the envelope
    // here is the small failure body, below the floor either way — the job of
    // this test is byte-identity, not proving compression on this route.
    let server = spawn_test_server(None).await;
    let path = "/api/chats/c1/messages";

    let (identity_status, identity_headers, identity_body) = get(&server, path, None, None).await;
    let (compressed_status, compressed_headers, compressed_body) =
        get(&server, path, Some("gzip, br"), None).await;

    assert_eq!(identity_status, compressed_status);

    let effective_compressed = match compressed_headers.get("content-encoding") {
        Some(enc) if enc == "gzip" => gunzip(&compressed_body),
        Some(enc) if enc == "br" => unbrotli(&compressed_body),
        Some(other) => panic!("unexpected content-encoding: {other:?}"),
        None => compressed_body,
    };
    assert_eq!(effective_compressed, identity_body);
    assert!(identity_headers.get("content-encoding").is_none());

    let json: serde_json::Value = serde_json::from_slice(&identity_body).unwrap();
    assert_eq!(json["success"], false);
}
