//! Observability tests for the attachment upload/serve paths: one structured
//! log record per outcome, with the request/chat identity but never the
//! payload (file names, base64 bytes) or the bearer token.
//!
//! This binary installs a single capturing `tracing` subscriber via a
//! `OnceLock`, so it affects only this file (`tests/*.rs` are separate
//! binaries). Tests run on parallel threads within the binary, so every test
//! drives a unique chat id and filters the shared capture buffer by it.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::io;
use std::sync::{Mutex, OnceLock};

use reqwest::StatusCode;
use serde_json::{Value, json};
use support::TestServerOptions;
use support::spawn_test_server_with;

const SMALL_IMAGE_DATA: &str = "aGVsbG8=";

static LOG_LINES: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
static INIT: OnceLock<()> = OnceLock::new();

fn log_lines() -> &'static Mutex<Vec<String>> {
    LOG_LINES.get_or_init(|| Mutex::new(Vec::new()))
}

#[derive(Clone, Copy)]
struct CaptureWriter;

impl io::Write for CaptureWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        log_lines()
            .lock()
            .unwrap()
            .push(String::from_utf8_lossy(buf).into_owned());
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn init_capture() {
    INIT.get_or_init(|| {
        tracing_subscriber::fmt()
            .with_ansi(false)
            .with_writer(|| CaptureWriter)
            .with_max_level(tracing::Level::INFO)
            .init();
    });
}

/// Lines emitted since the subscriber was installed that mention `needle`.
fn lines_containing(needle: &str) -> Vec<String> {
    log_lines()
        .lock()
        .unwrap()
        .iter()
        .filter(|line| line.contains(needle))
        .cloned()
        .collect()
}

fn small_image(name: &str) -> Value {
    json!({ "name": name, "mediaType": "image/png", "data": SMALL_IMAGE_DATA })
}

async fn post_attachments(
    server: &support::TestServer,
    chat: &str,
    body: Value,
) -> reqwest::Response {
    reqwest::Client::new()
        .post(server.http_url(&format!("/api/chats/{chat}/attachments")))
        .json(&body)
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn successful_upload_logs_exactly_one_record_with_count_and_bytes() {
    init_capture();
    let server = spawn_test_server_with(TestServerOptions::default()).await;
    let chat_id = "logging-success-c1";

    let res = post_attachments(
        &server,
        chat_id,
        json!({ "attachments": [small_image("a.png"), small_image("b.png")] }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);

    let matches = lines_containing(chat_id);
    assert_eq!(
        matches.len(),
        1,
        "expected exactly one record for {chat_id}, got: {matches:?}"
    );
    let record = &matches[0];
    assert!(record.contains("count=2"), "record: {record}");
    assert!(
        record.contains("total_bytes="),
        "record missing total_bytes: {record}"
    );
    assert!(
        !record.contains("a.png") && !record.contains("b.png"),
        "record must not name the uploaded files: {record}"
    );
    assert!(
        !record.contains(SMALL_IMAGE_DATA),
        "record must not contain the base64 payload: {record}"
    );
}

#[tokio::test]
async fn rejected_upload_logs_exactly_one_record_with_the_reason() {
    init_capture();
    let server = spawn_test_server_with(TestServerOptions::default()).await;
    let chat_id = "logging-rejected-c2";

    let mut item = small_image("big.png");
    item["sizeBytes"] = json!(6 * 1024 * 1024);
    let res = post_attachments(&server, chat_id, json!({ "attachments": [item] })).await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    let matches = lines_containing(chat_id);
    assert_eq!(
        matches.len(),
        1,
        "expected exactly one record for {chat_id}, got: {matches:?}"
    );
    let record = &matches[0];
    assert!(
        record.contains("exceeds") || record.contains("5MB") || record.contains("5mb"),
        "record must name the rejection reason: {record}"
    );
    assert!(
        !record.contains("big.png"),
        "record must not name the rejected file: {record}"
    );
}

#[tokio::test]
async fn non_loopback_unauthenticated_request_returns_401_and_logs_the_path() {
    init_capture();
    let server = spawn_test_server_with(TestServerOptions {
        auth_secret: Some("test-secret-key-at-least-32-chars-long!!".to_string()),
        ..TestServerOptions::default()
    })
    .await;
    let chat_id = "logging-unauth-c3";
    let path = format!("/api/chats/{chat_id}/attachments");

    let res = reqwest::Client::new()
        .post(server.http_url(&path))
        .header("X-Forwarded-For", "203.0.113.44")
        .json(&json!({ "attachments": [small_image("a.png")] }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    let matches = lines_containing(&path);
    assert_eq!(
        matches.len(),
        1,
        "expected exactly one record for {path}, got: {matches:?}"
    );
    let record = &matches[0];
    assert!(
        !record.contains("Bearer"),
        "record must not contain the word Bearer: {record}"
    );
    assert!(
        !record.contains("test-secret-key-at-least-32-chars-long"),
        "record must not contain any token/secret substring: {record}"
    );
}

#[tokio::test]
async fn file_kind_upload_still_materializes_with_an_id() {
    init_capture();
    let server = spawn_test_server_with(TestServerOptions::default()).await;
    let chat_id = "logging-filekind-c4";

    let res = post_attachments(
        &server,
        chat_id,
        json!({ "attachments": [{ "name": "doc.txt", "mediaType": "text/plain", "data": SMALL_IMAGE_DATA }] }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["data"]["attachments"][0]["kind"], "file");
    assert!(body["data"]["attachments"][0]["id"].is_string());
}
