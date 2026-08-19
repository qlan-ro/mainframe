//! Route-level device-flow tests. The HTTP semantics of `start`/`poll_once`
//! itself (interval, slow_down, expired_token, access_denied...) are covered
//! against a mock GitHub in `mainframe-automations`'s `github_device_tests`;
//! this file covers the route's own job: outcome→response mapping and that
//! a `Connected` poll persists the token without echoing it back.

use axum::body::to_bytes;
use mainframe_automations::github_device::GithubDeviceFlow;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::{device_flow_status_for, poll_and_respond, start_response};
use crate::routes::automations_test_support::automations_ctx;

async fn body_json(resp: axum::response::Response) -> (axum::http::StatusCode, serde_json::Value) {
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

fn epoch_ms_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[tokio::test]
async fn device_status_reports_unconfigured_when_no_client_id_is_set() {
    // Injects an empty client ID rather than reading the shipped constant:
    // this pins the UNCONFIGURED contract, which must keep holding after an
    // app is registered — a test that breaks the day the product is
    // configured is testing the constant, not the behaviour.
    let flow = GithubDeviceFlow::with_urls("http://unused/code", "http://unused/token", "");

    assert!(!flow.is_configured());
    let (status, body) = body_json(device_flow_status_for(&flow).await).await;

    assert_eq!(status, axum::http::StatusCode::OK);
    assert_eq!(body["data"]["configured"], false);
}

#[tokio::test]
async fn device_status_reports_configured_once_a_client_id_ships() {
    let flow = GithubDeviceFlow::with_urls(
        "http://unused/code",
        "http://unused/token",
        "Iv23lixxxxxxxxxxxxxx",
    );

    assert!(flow.is_configured());
    let (status, body) = body_json(device_flow_status_for(&flow).await).await;

    assert_eq!(status, axum::http::StatusCode::OK);
    assert_eq!(body["data"]["configured"], true);
}

#[tokio::test]
async fn start_reports_not_configured_when_no_client_id_is_set() {
    // Injected, not the shipped constant — a build with no app registered
    // must read as "unavailable" rather than a generic failure, and that has
    // to stay true regardless of whether this repo's own app is configured.
    let flow = GithubDeviceFlow::with_urls("http://unused/code", "http://unused/token", "");
    let (status, body) = body_json(start_response(flow.start().await)).await;

    assert_eq!(status, axum::http::StatusCode::NOT_IMPLEMENTED);
    assert_eq!(body["success"], false);
    assert!(body["error"].as_str().unwrap().contains("client ID"));
}

#[tokio::test]
async fn poll_connected_persists_the_token_and_never_echoes_it() {
    let harness = automations_ctx().await;
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "ghu_secret",
        })))
        .mount(&server)
        .await;
    let flow = GithubDeviceFlow::with_urls(
        format!("{}/device", server.uri()),
        format!("{}/token", server.uri()),
        "test-client",
    );

    let (status, body) = body_json(poll_and_respond(&flow, "dc-1", &harness.engine).await).await;

    assert_eq!(status, axum::http::StatusCode::OK);
    assert_eq!(
        body,
        serde_json::json!({"success": true, "data": {"status": "connected"}})
    );
    assert_eq!(
        harness.engine.credential_labels().await,
        vec!["github".to_string()]
    );
    // The GET credential route deliberately never returns the value; check
    // the same invariant against the store the route just wrote through.
    let kind = harness.engine.credential_kind("github").await.unwrap();
    assert_eq!(
        serde_json::to_value(kind).unwrap(),
        serde_json::json!("token")
    );
}

#[tokio::test]
async fn poll_connected_for_a_github_app_persists_the_refresh_token_and_expiry() {
    let harness = automations_ctx().await;
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "ghu_secret",
            "refresh_token": "ghr_secret",
            "expires_in": 28800,
        })))
        .mount(&server)
        .await;
    let flow = GithubDeviceFlow::with_urls(
        format!("{}/device", server.uri()),
        format!("{}/token", server.uri()),
        "test-client",
    );

    let before = epoch_ms_now();
    let (status, _body) = body_json(poll_and_respond(&flow, "dc-1", &harness.engine).await).await;
    assert_eq!(status, axum::http::StatusCode::OK);

    let creds = harness.engine.credentials().get("github").await.unwrap();
    assert_eq!(creds.refresh_token, Some("ghr_secret".to_string()));
    let expires_at = creds
        .expires_at
        .expect("expires_at set for a GitHub App token");
    let expected = before + 28_800_000;
    assert!(
        (expected - 5_000..=expected + 5_000).contains(&expires_at),
        "expires_at {expires_at} not within 5s of expected {expected}"
    );
}

#[tokio::test]
async fn poll_pending_reports_status_without_touching_the_credential_store() {
    let harness = automations_ctx().await;
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "error": "authorization_pending",
        })))
        .mount(&server)
        .await;
    let flow = GithubDeviceFlow::with_urls(
        format!("{}/device", server.uri()),
        format!("{}/token", server.uri()),
        "test-client",
    );

    let (status, body) = body_json(poll_and_respond(&flow, "dc-1", &harness.engine).await).await;

    assert_eq!(status, axum::http::StatusCode::OK);
    assert_eq!(body["data"]["status"], "pending");
    assert!(harness.engine.credential_labels().await.is_empty());
}

#[tokio::test]
async fn poll_slow_down_reports_the_new_interval() {
    let harness = automations_ctx().await;
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "error": "slow_down",
            "interval": 5,
        })))
        .mount(&server)
        .await;
    let flow = GithubDeviceFlow::with_urls(
        format!("{}/device", server.uri()),
        format!("{}/token", server.uri()),
        "test-client",
    );

    let (_status, body) = body_json(poll_and_respond(&flow, "dc-1", &harness.engine).await).await;

    assert_eq!(
        body["data"],
        serde_json::json!({"status": "slow_down", "interval": 10})
    );
}

#[tokio::test]
async fn poll_expired_and_denied_report_distinct_statuses() {
    let harness = automations_ctx().await;
    for (error_code, expected_status) in [("expired_token", "expired"), ("access_denied", "denied")]
    {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "error": error_code,
            })))
            .mount(&server)
            .await;
        let flow = GithubDeviceFlow::with_urls(
            format!("{}/device", server.uri()),
            format!("{}/token", server.uri()),
            "test-client",
        );

        let (_status, body) =
            body_json(poll_and_respond(&flow, "dc-1", &harness.engine).await).await;

        assert_eq!(
            body["data"]["status"], expected_status,
            "for error {error_code}"
        );
    }
}
