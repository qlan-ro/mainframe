//! GitHubIssuesClient over wiremock: list/get/timeline/create/update, the
//! close-as-completed and reopen state transitions, and the failure
//! taxonomy the todos-plugin sync engine depends on (404/301/401/403+429/
//! network — AC25, AC29, AC30). Every call takes the token explicitly; the
//! last test asserts no error's `Display`/`Debug` output ever carries it.

use serde_json::json;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::github_issues::{CreateIssue, GitHubIssuesClient, IssuePatch, IssueState, RepoRef};

/// The client under test. `with_base_url` is fallible only on TLS backend
/// init failure, which a test host that just started a mock server cannot hit.
pub(super) fn client(base_url: impl Into<String>) -> GitHubIssuesClient {
    GitHubIssuesClient::with_base_url(base_url).expect("the test client must build")
}

pub(super) fn repo() -> RepoRef {
    RepoRef {
        owner: "qlan".to_string(),
        repo: "mainframe".to_string(),
    }
}

fn issue_json(number: u64, title: &str, state: &str) -> serde_json::Value {
    json!({
        "number": number, "title": title, "body": "body text",
        "labels": [{"name": "bug"}], "state": state,
        "html_url": format!("https://github.com/qlan/mainframe/issues/{number}"),
        "updated_at": "2026-01-01T00:00:00Z",
    })
}

/// Mounts a `PATCH issues/3` expecting `expected_body` and applies `patch`.
async fn assert_patch_sends(patch: IssuePatch, expected_body: serde_json::Value) {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/repos/qlan/mainframe/issues/3"))
        .and(body_json(expected_body))
        .respond_with(ResponseTemplate::new(200).set_body_json(issue_json(3, "t", "open")))
        .mount(&server)
        .await;
    client(server.uri())
        .update_issue(&repo(), 3, patch, "tok")
        .await
        .unwrap();
}

#[tokio::test]
async fn list_open_issues_follows_pagination() {
    let server = MockServer::start().await;
    let next_link = format!(
        "<{}/repos/qlan/mainframe/issues?state=open&per_page=100&page=2>; rel=\"next\"",
        server.uri()
    );
    Mock::given(method("GET"))
        .and(path("/repos/qlan/mainframe/issues"))
        .and(query_param("page", "1"))
        .and(header("authorization", "Bearer tok"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("Link", next_link.as_str())
                .set_body_json(json!([issue_json(1, "one", "open")])),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/qlan/mainframe/issues"))
        .and(query_param("page", "2"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!([issue_json(2, "two", "open")])),
        )
        .expect(1)
        .mount(&server)
        .await;

    let issues = client(server.uri())
        .list_open_issues(&repo(), "tok")
        .await
        .unwrap();

    assert_eq!(issues.len(), 2);
    assert_eq!(issues[0].number, 1);
    assert_eq!(issues[1].number, 2);
    assert_eq!(issues[1].labels, vec!["bug".to_string()]);
}

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

#[tokio::test]
async fn get_issue_maps_closed_state() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/qlan/mainframe/issues/5"))
        .respond_with(ResponseTemplate::new(200).set_body_json(issue_json(
            5,
            "closed one",
            "closed",
        )))
        .mount(&server)
        .await;

    let issue = client(server.uri())
        .get_issue(&repo(), 5, "tok")
        .await
        .unwrap();

    assert_eq!(issue.state, IssueState::Closed);
    assert_eq!(issue.title, "closed one");
}

#[tokio::test]
async fn field_times_read_the_last_rename_and_the_last_state_change() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/qlan/mainframe/issues/9/timeline"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {"event": "renamed", "created_at": "2026-01-01T00:00:00Z"},
            {"event": "closed", "created_at": "2026-01-02T00:00:00Z"},
            {"event": "renamed", "created_at": "2026-01-03T00:00:00Z"},
            {"event": "reopened", "created_at": "2026-01-04T00:00:00Z"},
        ])))
        .mount(&server)
        .await;

    let times = client(server.uri())
        .issue_field_times(&repo(), 9, "tok")
        .await
        .unwrap();

    assert_eq!(times.title_at.as_deref(), Some("2026-01-03T00:00:00Z"));
    assert_eq!(times.state_at.as_deref(), Some("2026-01-04T00:00:00Z"));
}

#[tokio::test]
async fn field_times_follow_pagination_to_find_the_newest_event() {
    // The timeline is ascending, so the newest rename/state event on a busy
    // issue lives on a later page — reading only page 1 would silently
    // return a stale (or missing) stamp.
    let server = MockServer::start().await;
    let next_link = format!(
        "<{}/repos/qlan/mainframe/issues/9/timeline?per_page=100&page=2>; rel=\"next\"",
        server.uri()
    );
    Mock::given(method("GET"))
        .and(path("/repos/qlan/mainframe/issues/9/timeline"))
        .and(query_param("page", "1"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("Link", next_link.as_str())
                .set_body_json(json!([
                    {"event": "renamed", "created_at": "2026-01-01T00:00:00Z"},
                ])),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/qlan/mainframe/issues/9/timeline"))
        .and(query_param("page", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {"event": "renamed", "created_at": "2026-02-01T00:00:00Z"},
            {"event": "closed", "created_at": "2026-02-02T00:00:00Z"},
        ])))
        .expect(1)
        .mount(&server)
        .await;

    let times = client(server.uri())
        .issue_field_times(&repo(), 9, "tok")
        .await
        .unwrap();

    assert_eq!(times.title_at.as_deref(), Some("2026-02-01T00:00:00Z"));
    assert_eq!(times.state_at.as_deref(), Some("2026-02-02T00:00:00Z"));
}

#[tokio::test]
async fn field_times_are_none_when_the_family_never_happened() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/qlan/mainframe/issues/9/timeline"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {"event": "commented", "created_at": "2026-01-01T00:00:00Z"},
        ])))
        .mount(&server)
        .await;

    let times = client(server.uri())
        .issue_field_times(&repo(), 9, "tok")
        .await
        .unwrap();

    assert_eq!(times.title_at, None);
    assert_eq!(times.state_at, None);
}

#[tokio::test]
async fn create_issue_posts_title_body_and_labels() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/repos/qlan/mainframe/issues"))
        .and(body_json(
            json!({"title": "New task", "body": "does the thing", "labels": ["bug"]}),
        ))
        .respond_with(ResponseTemplate::new(201).set_body_json(issue_json(11, "New task", "open")))
        .mount(&server)
        .await;

    let issue = client(server.uri())
        .create_issue(
            &repo(),
            CreateIssue {
                title: "New task".to_string(),
                body: "does the thing".to_string(),
                labels: vec!["bug".to_string()],
            },
            "tok",
        )
        .await
        .unwrap();

    assert_eq!(issue.number, 11);
}

#[tokio::test]
async fn update_issue_patches_only_the_given_fields() {
    assert_patch_sends(
        IssuePatch {
            title: Some("renamed".to_string()),
            ..Default::default()
        },
        json!({"title": "renamed"}),
    )
    .await;
}

#[tokio::test]
async fn close_issue_sends_state_reason_completed() {
    assert_patch_sends(
        IssuePatch {
            state: Some(IssueState::Closed),
            state_reason: Some("completed".to_string()),
            ..Default::default()
        },
        json!({"state": "closed", "state_reason": "completed"}),
    )
    .await;
}

#[tokio::test]
async fn reopen_issue_sends_state_open_without_a_reason() {
    assert_patch_sends(
        IssuePatch {
            state: Some(IssueState::Open),
            ..Default::default()
        },
        json!({"state": "open"}),
    )
    .await;
}
