//! GitHub device flow over wiremock: `start()` plus one `poll_once` test per
//! outcome (`notion_ado_tests.rs`-style mock-server tests).

use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::github_device::{DeviceFlowError, GithubDeviceFlow, PollOutcome};

async fn flow(server: &MockServer, client_id: &'static str) -> GithubDeviceFlow {
    GithubDeviceFlow::with_urls(
        format!("{}/login/device/code", server.uri()),
        format!("{}/login/oauth/access_token", server.uri()),
        client_id,
    )
}

#[tokio::test]
async fn start_returns_the_user_code_and_verification_uri() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/login/device/code"))
        .and(body_string_contains("client_id=test-client"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "device_code": "dc-1",
            "user_code": "WDJB-MJHT",
            "verification_uri": "https://github.com/login/device",
            "expires_in": 900,
            "interval": 5,
        })))
        .expect(1)
        .mount(&server)
        .await;

    let started = flow(&server, "test-client").await.start().await.unwrap();

    assert_eq!(started.device_code, "dc-1");
    assert_eq!(started.user_code, "WDJB-MJHT");
    assert_eq!(started.verification_uri, "https://github.com/login/device");
    assert_eq!(started.interval, 5);
    assert_eq!(started.expires_in, 900);
}

#[tokio::test]
async fn start_without_a_configured_client_id_fails_without_a_request() {
    let server = MockServer::start().await;
    // No mock mounted — a request here would panic wiremock's unhandled-call guard.

    let err = flow(&server, "").await.start().await.unwrap_err();

    assert_eq!(err, DeviceFlowError::NotConfigured);
}

#[tokio::test]
async fn poll_pending_when_the_user_has_not_entered_the_code_yet() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/login/oauth/access_token"))
        .and(body_string_contains(
            "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code",
        ))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({"error": "authorization_pending"})),
        )
        .mount(&server)
        .await;

    let outcome = flow(&server, "test-client")
        .await
        .poll_once("dc-1")
        .await
        .unwrap();

    assert_eq!(outcome, PollOutcome::Pending);
}

#[tokio::test]
async fn poll_slow_down_adds_five_seconds_to_the_interval() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/login/oauth/access_token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "error": "slow_down",
            "interval": 5,
        })))
        .mount(&server)
        .await;

    let outcome = flow(&server, "test-client")
        .await
        .poll_once("dc-1")
        .await
        .unwrap();

    assert_eq!(outcome, PollOutcome::SlowDown { new_interval: 10 });
}

#[tokio::test]
async fn poll_expired_when_the_device_code_timed_out() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/login/oauth/access_token"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"error": "expired_token"})),
        )
        .mount(&server)
        .await;

    let outcome = flow(&server, "test-client")
        .await
        .poll_once("dc-1")
        .await
        .unwrap();

    assert_eq!(outcome, PollOutcome::Expired);
}

#[tokio::test]
async fn poll_denied_when_the_user_cancels() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/login/oauth/access_token"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"error": "access_denied"})),
        )
        .mount(&server)
        .await;

    let outcome = flow(&server, "test-client")
        .await
        .poll_once("dc-1")
        .await
        .unwrap();

    assert_eq!(outcome, PollOutcome::Denied);
}

#[tokio::test]
async fn poll_connected_carries_the_access_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/login/oauth/access_token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "ghu_abc123",
            "token_type": "bearer",
        })))
        .mount(&server)
        .await;

    let outcome = flow(&server, "test-client")
        .await
        .poll_once("dc-1")
        .await
        .unwrap();

    assert_eq!(
        outcome,
        PollOutcome::Connected {
            token: "ghu_abc123".to_string(),
            expires_in: None,
            refresh_token: None,
        }
    );
}

#[tokio::test]
async fn poll_connected_carries_the_github_app_expiry_and_refresh_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/login/oauth/access_token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "ghu_abc123",
            "token_type": "bearer",
            "expires_in": 28800,
            "refresh_token": "ghr_refresh123",
            "refresh_token_expires_in": 15811200,
        })))
        .mount(&server)
        .await;

    let outcome = flow(&server, "test-client")
        .await
        .poll_once("dc-1")
        .await
        .unwrap();

    assert_eq!(
        outcome,
        PollOutcome::Connected {
            token: "ghu_abc123".to_string(),
            expires_in: Some(28800),
            refresh_token: Some("ghr_refresh123".to_string()),
        }
    );
}

#[tokio::test]
async fn poll_an_unrecognized_error_code_surfaces_verbatim() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/login/oauth/access_token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "error": "incorrect_device_code",
        })))
        .mount(&server)
        .await;

    let outcome = flow(&server, "test-client")
        .await
        .poll_once("dc-1")
        .await
        .unwrap();

    assert_eq!(
        outcome,
        PollOutcome::Other("incorrect_device_code".to_string())
    );
}

#[tokio::test]
async fn poll_without_a_configured_client_id_fails_without_a_request() {
    let server = MockServer::start().await;

    let err = flow(&server, "").await.poll_once("dc-1").await.unwrap_err();

    assert_eq!(err, DeviceFlowError::NotConfigured);
}
