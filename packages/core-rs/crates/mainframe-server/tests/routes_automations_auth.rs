//! Contract §9 negative test: every `/api/automation*` route still 401s for a
//! non-loopback caller without a token — ONLY the webhook ingress path is
//! auth-exempt, and the exemption is exactly one path segment wide (it must
//! not reopen the X-Forwarded-For finding).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::{Method, StatusCode};
use support::spawn_test_server;

const SECRET: &str = "test-secret-key-at-least-32-chars-long!!";
const NON_LOOPBACK: &str = "203.0.113.9";

fn authed_routes() -> Vec<(Method, &'static str)> {
    vec![
        (Method::GET, "/api/automations"),
        (Method::POST, "/api/automations"),
        (Method::GET, "/api/automations/a1"),
        (Method::PUT, "/api/automations/a1"),
        (Method::DELETE, "/api/automations/a1"),
        (Method::PATCH, "/api/automations/a1/enabled"),
        (Method::POST, "/api/automations/a1/runs"),
        (Method::GET, "/api/automations/a1/runs"),
        (Method::GET, "/api/automation-runs/r1"),
        (Method::POST, "/api/automation-runs/r1/cancel"),
        (Method::GET, "/api/automation-interactions"),
        (Method::POST, "/api/automation-interactions/i1/respond"),
        (Method::GET, "/api/automation-actions"),
        (Method::GET, "/api/automation-credentials"),
        (Method::GET, "/api/automation-credentials/github"),
        (Method::PUT, "/api/automation-credentials/github"),
        (Method::DELETE, "/api/automation-credentials/github"),
    ]
}

#[tokio::test]
async fn every_automation_route_requires_auth_for_non_loopback() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let client = reqwest::Client::new();
    for (method, path) in authed_routes() {
        let status = client
            .request(method.clone(), server.http_url(path))
            .header("X-Forwarded-For", NON_LOOPBACK)
            .send()
            .await
            .unwrap()
            .status();
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "{method} {path} must 401 without a token"
        );
    }
}

#[tokio::test]
async fn webhook_ingress_is_auth_exempt_by_path() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    // No engine in this harness: reaching the handler yields 503 — anything
    // but 401 proves the request passed the auth layer.
    let status = reqwest::Client::new()
        .post(server.http_url("/api/automation-webhooks/hook-1"))
        .header("X-Forwarded-For", NON_LOOPBACK)
        .body("{}")
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn webhook_exemption_is_exactly_one_segment_wide() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let client = reqwest::Client::new();
    for path in [
        "/api/automation-webhooks",
        "/api/automation-webhooks/",
        "/api/automation-webhooks/h1/extra",
    ] {
        let status = client
            .post(server.http_url(path))
            .header("X-Forwarded-For", NON_LOOPBACK)
            .send()
            .await
            .unwrap()
            .status();
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path} must stay authed");
    }
}

#[tokio::test]
async fn spoofed_leftmost_loopback_hop_stays_rejected_on_automation_routes() {
    // The WS X-Forwarded-For finding must not reopen through the webhook
    // exemption: a forged leftmost 127.0.0.1 with a real non-loopback hop is
    // still a non-loopback caller for every authed automation route.
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let status = reqwest::Client::new()
        .get(server.http_url("/api/automations"))
        .header("X-Forwarded-For", format!("127.0.0.1, {NON_LOOPBACK}"))
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
