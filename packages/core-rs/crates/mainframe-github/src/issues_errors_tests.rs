//! How GitHubIssuesClient maps failures to `GitHubError`. The todos sync
//! treats `NotFound`, `Moved`, `Request` and `UnexpectedResponse` as per-pair
//! failures and stops the run on everything else.

use std::time::{Duration, SystemTime, UNIX_EPOCH};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::tests::{client, issue_json, repo};
use super::{GitHubError, GitHubIssuesClient};

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
async fn too_many_requests_with_a_spent_budget_waits_for_the_reset() {
    let reset_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + 300;
    let err = get_issue_error(
        ResponseTemplate::new(429)
            .insert_header("X-RateLimit-Remaining", "0")
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
async fn forbidden_secondary_rate_limit_without_retry_after_waits_a_minute() {
    // A secondary limit can answer 403 with budget left and no `Retry-After`.
    // Without the message check it reads as bad credentials and the sync
    // asks the user to reconnect.
    let err = get_issue_error(
        ResponseTemplate::new(403)
            .insert_header("x-ratelimit-remaining", "4000")
            .set_body_json(serde_json::json!({
                "message": "You have exceeded a secondary rate limit. Please wait a few minutes before you try again."
            })),
        "tok",
    )
    .await;
    assert_eq!(
        err,
        GitHubError::RateLimited {
            wait: Some(Duration::from_secs(60))
        }
    );
}

#[tokio::test]
async fn too_many_requests_honours_retry_after() {
    let err = get_issue_error(
        ResponseTemplate::new(429)
            .insert_header("Retry-After", "30")
            .insert_header("x-ratelimit-remaining", "4000"),
        "tok",
    )
    .await;
    assert_eq!(
        err,
        GitHubError::RateLimited {
            wait: Some(Duration::from_secs(30))
        }
    );
}

#[tokio::test]
async fn a_stalled_response_times_out_as_a_network_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/qlan/mainframe/issues/1"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(issue_json(1, "t", "open"))
                .set_delay(Duration::from_secs(5)),
        )
        .mount(&server)
        .await;

    let err = GitHubIssuesClient::with_base_url(server.uri())
        .unwrap()
        .with_timeout(Duration::from_millis(100))
        .get_issue(&repo(), 1, "tok")
        .await
        .unwrap_err();

    assert!(matches!(err, GitHubError::Network(_)), "{err:?}");
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

#[tokio::test]
async fn pagination_refuses_a_link_to_another_origin() {
    // The bearer token goes with every page request, so a `Link` header that
    // names another host must stop the listing rather than be followed.
    let api = MockServer::start().await;
    let elsewhere = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .expect(0)
        .mount(&elsewhere)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/qlan/mainframe/issues"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!([issue_json(1, "one", "open")]))
                .insert_header(
                    "Link",
                    format!(
                        "<{}/repos/qlan/mainframe/issues?page=2>; rel=\"next\"",
                        elsewhere.uri()
                    )
                    .as_str(),
                ),
        )
        .mount(&api)
        .await;

    let err = client(api.uri())
        .list_open_issues(&repo(), "tok")
        .await
        .unwrap_err();

    assert!(matches!(err, GitHubError::UnexpectedResponse(_)), "{err:?}");
}

#[tokio::test]
async fn a_body_that_does_not_decode_is_an_unexpected_response() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/qlan/mainframe/issues/5"))
        .respond_with(ResponseTemplate::new(200).set_body_string("<html>maintenance</html>"))
        .mount(&server)
        .await;

    let err = client(server.uri())
        .get_issue(&repo(), 5, "tok")
        .await
        .unwrap_err();

    assert!(matches!(err, GitHubError::UnexpectedResponse(_)), "{err:?}");
}

#[test]
fn an_invalid_base_url_is_rejected_at_construction() {
    let err = GitHubIssuesClient::with_base_url("not a url")
        .err()
        .unwrap();
    assert!(matches!(err, GitHubError::Unavailable(_)), "{err:?}");
}
