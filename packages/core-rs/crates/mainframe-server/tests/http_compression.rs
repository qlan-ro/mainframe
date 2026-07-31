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
#![allow(clippy::unwrap_used, clippy::expect_used, dead_code)]

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
