//! Route-level tests for `/api/skills-cli/search` (todo #243 addendum). Only
//! the rejection paths run here: everything past validation reaches
//! skills.sh, and a test suite that depends on a third-party registry being up
//! is a flaky test suite. The outcome mapping is covered by
//! `routes::skills_registry`'s unit tests and `skills_cli_catalog.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::StatusCode;
use serde_json::{Value, json};
use support::{TestServer, spawn_test_server};

async fn get_json(server: &TestServer, path: &str) -> (StatusCode, Value) {
    let res = reqwest::get(server.http_url(path)).await.unwrap();
    let status = res.status();
    (status, res.json().await.unwrap())
}

/// The registry rejects a one-character query itself, so spending the round
/// trip to be told so is pure latency. Rejecting here also means the debounced
/// UI can't accidentally hammer it a keystroke at a time.
#[tokio::test]
async fn search_rejects_a_one_character_query_before_reaching_the_registry() {
    let server = spawn_test_server(None).await;

    let (status, body) = get_json(&server, "/api/skills-cli/search?q=p").await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        json!({ "success": false, "error": "q must be at least 2 characters" })
    );
}

#[tokio::test]
async fn search_rejects_a_missing_query() {
    let server = spawn_test_server(None).await;

    let (status, _) = get_json(&server, "/api/skills-cli/search").await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn search_rejects_a_query_that_is_only_whitespace_around_one_character() {
    let server = spawn_test_server(None).await;

    let (status, _) = get_json(&server, "/api/skills-cli/search?q=%20%20p%20%20").await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}
