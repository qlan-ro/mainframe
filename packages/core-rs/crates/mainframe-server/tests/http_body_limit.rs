//! Pins the ordering of `DefaultBodyLimit::disable()` above
//! `RequestBodyLimitLayer` in `build_app` (todo #299). Asserts against the
//! assembled router, not the limit constants in isolation, so a limit
//! relocated into a different layer is still covered. These tests are green
//! from birth — they cover behavior that already shipped in PR #549 — and
//! their red-phase evidence is the manual sabotage pass recorded in the PR
//! description, not a failing run here.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::StatusCode;
use serde_json::Value;
use support::spawn_test_server;

/// axum's old built-in per-extractor default, which used to shadow the
/// explicit `RequestBodyLimitLayer` before PR #549.
const DEFAULT_EXTRACTOR_LIMIT_BYTES: usize = 2 * 1024 * 1024;

#[tokio::test]
async fn a_three_megabyte_body_reaches_the_attachments_handler() {
    let data = "A".repeat(3 * 1024 * 1024);
    let payload = serde_json::json!({
        "attachments": [{
            "name": "dead-zone.bin",
            "mediaType": "application/octet-stream",
            "data": data,
        }]
    });
    let body = serde_json::to_vec(&payload).unwrap();

    assert!(
        body.len() > DEFAULT_EXTRACTOR_LIMIT_BYTES,
        "request must sit inside the old dead zone, above axum's former 2 MB default"
    );
    assert!(
        body.len() < mainframe_server::BODY_LIMIT_BYTES,
        "request must stay under the configured limit"
    );
    assert!(
        data.len() * 3 / 4 < 5 * 1024 * 1024,
        "payload must clear the route's own 5 MB per-item rule, or a 400 here would prove nothing about the body-limit layer"
    );

    let server = spawn_test_server(None).await;
    let res = reqwest::Client::new()
        .post(server.http_url("/api/chats/c1/attachments"))
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .unwrap();

    let status = res.status();
    let raw = res.bytes().await.unwrap();
    assert_eq!(
        status,
        StatusCode::OK,
        "413 here means the default extractor limit is back: {}",
        String::from_utf8_lossy(&raw)
    );

    let json: Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(json["success"], true);
    let attachment = &json["data"]["attachments"][0];
    assert_eq!(attachment["name"], "dead-zone.bin");
    assert_eq!(attachment["mediaType"], "application/octet-stream");
    assert_eq!(attachment["sizeBytes"], 2_359_296);
    assert!(attachment["id"].as_str().is_some_and(|id| !id.is_empty()));
}
