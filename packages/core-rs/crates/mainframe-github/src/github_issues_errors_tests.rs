//! GitHubIssuesClient failure taxonomy the todos-plugin sync engine depends
//! on (404/301/401/403+429/network — AC25, AC29, AC30). Split out of
//! `github_issues_tests.rs` to keep both files under the 300-line limit.

use std::time::{Duration, SystemTime, UNIX_EPOCH};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::github_issues::GitHubError;
use super::github_issues_tests::{client, issue_json, repo};

#[tokio::test]
async fn requests_carry_a_user_agent() {
    // The live API answers 403 "Request forbidden by administrative rules" to a
    // request without one; reqwest sends none by default, so only a header
    // assertion catches the regression before it reaches GitHub.
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/qlan/mainframe/issues/5"))
        .and(header("user-agent", "mainframe"))
        .respond_with(ResponseTemplate::new(200).set_body_json(issue_json(5, "t", "open")))
        .expect(1)
        .mount(&server)
        .await;

    client(server.uri())
        .get_issue(&repo(), 5, "tok")
        .await
        .unwrap();
}

/// Mounts a single `GET issues/1` response and returns the error `get_issue` produces.
async fn get_issue_error(response: ResponseTemplate, token: &str) -> GitHubError {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/qlan/mainframe/issues/1"))
        .respond_with(response)
        .mount(&server)
        .await;
    client(server.uri())
        .get_issue(&repo(), 1, token)
        .await
        .unwrap_err()
}

#[tokio::test]
async fn not_found_maps_to_the_not_found_variant() {
    let err = get_issue_error(
        ResponseTemplate::new(404).set_body_string("Not Found"),
        "tok",
    )
    .await;
    assert_eq!(err, GitHubError::NotFound);
}

#[tokio::test]
async fn a_redirect_is_not_followed() {
    let err = get_issue_error(
        ResponseTemplate::new(301)
            .insert_header("Location", "https://api.github.com/repositories/1/issues/1"),
        "tok",
    )
    .await;
    assert_eq!(err, GitHubError::Moved);
}

#[tokio::test]
async fn unauthorized_maps_to_auth() {
    let err = get_issue_error(
        ResponseTemplate::new(401).set_body_string("Bad credentials"),
        "tok",
    )
    .await;
    assert!(matches!(err, GitHubError::Auth(_)));
}

#[tokio::test]
async fn forbidden_with_retry_after_maps_to_rate_limited() {
    let err = get_issue_error(
        ResponseTemplate::new(403)
            .insert_header("Retry-After", "120")
            .set_body_string("secondary rate limit"),
        "tok",
    )
    .await;
    assert_eq!(
        err,
        GitHubError::RateLimited {
            wait: Some(Duration::from_secs(120))
        }
    );
}

#[tokio::test]
async fn forbidden_primary_rate_limit_with_no_retry_after_maps_to_rate_limited() {
    // GitHub's primary rate limit answers 403 with `x-ratelimit-remaining: 0`
    // and no `Retry-After` — only the secondary limit sends `Retry-After`.
    let reset_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + 300;
    let err = get_issue_error(
        ResponseTemplate::new(403)
            .insert_header("x-ratelimit-remaining", "0")
            .insert_header("x-ratelimit-reset", reset_at.to_string().as_str())
            .set_body_string("API rate limit exceeded"),
        "tok",
    )
    .await;
    match err {
        GitHubError::RateLimited { wait: Some(wait) } => {
            assert!(wait.as_secs() <= 300 && wait.as_secs() >= 295, "{wait:?}");
        }
        other => panic!("expected RateLimited with a wait, got {other:?}"),
    }
}

#[tokio::test]
async fn forbidden_with_nonzero_remaining_still_maps_to_auth() {
    let err = get_issue_error(
        ResponseTemplate::new(403)
            .insert_header("x-ratelimit-remaining", "42")
            .set_body_string("Bad credentials"),
        "tok",
    )
    .await;
    assert!(matches!(err, GitHubError::Auth(_)));
}

#[tokio::test]
async fn too_many_requests_with_reset_header_maps_to_rate_limited() {
    let reset_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + 300;
    let err = get_issue_error(
        ResponseTemplate::new(429)
            .insert_header("X-RateLimit-Reset", reset_at.to_string().as_str())
            .set_body_string("rate limited"),
        "tok",
    )
    .await;
    match err {
        GitHubError::RateLimited { wait: Some(wait) } => {
            assert!(wait.as_secs() <= 300 && wait.as_secs() >= 295, "{wait:?}");
        }
        other => panic!("expected RateLimited with a wait, got {other:?}"),
    }
}

#[tokio::test]
async fn a_network_failure_maps_to_network() {
    let err = client("http://127.0.0.1:1")
        .get_issue(&repo(), 1, "tok")
        .await
        .unwrap_err();
    assert!(matches!(err, GitHubError::Network(_)));
}

#[tokio::test]
async fn no_error_ever_carries_the_bearer_token() {
    let err = get_issue_error(
        ResponseTemplate::new(401).set_body_string("Bad credentials"),
        "super-secret-token",
    )
    .await;
    assert!(!format!("{err}").contains("super-secret-token"));
    assert!(!format!("{err:?}").contains("super-secret-token"));
}
