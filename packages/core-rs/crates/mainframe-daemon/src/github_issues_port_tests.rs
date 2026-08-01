//! Task 5b — the daemon's `GitHubIssues` adapter over the automations
//! engine's own client + credential store. Every case matters for AC1/AC3/
//! AC6/AC8: a credential connected after construction must resolve without
//! rebuilding the port, and a missing credential must fail with a readable
//! reason rather than reaching the network with an empty token.

use std::sync::{Arc, Mutex};

use mainframe_automations::credentials::{
    CredentialError, CredentialKind, CredentialStore, Credentials,
};
use mainframe_automations::engine::BoxFuture;
use mainframe_plugins::{
    CreateIssue, GitHubIssues, GitHubPortError, IssuePatch, IssueState, RepoRef,
};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::github_issues_port::DaemonGitHubIssuesPort;

/// An in-memory `CredentialStore` whose contents can change after
/// construction — the seam that proves the port re-reads on every call.
#[derive(Default)]
struct MutableCredentialStore {
    tokens: Mutex<Option<String>>,
}

impl MutableCredentialStore {
    fn set(&self, token: &str) {
        *self.tokens.lock().unwrap() = Some(token.to_string());
    }
}

impl CredentialStore for MutableCredentialStore {
    fn get<'a>(&'a self, _label: &'a str) -> BoxFuture<'a, Option<Credentials>> {
        let token = self.tokens.lock().unwrap().clone();
        Box::pin(async move {
            token.map(|token| Credentials {
                kind: CredentialKind::Token,
                token,
                extra: None,
            })
        })
    }
    fn set<'a>(
        &'a self,
        _label: &'a str,
        _creds: Credentials,
    ) -> BoxFuture<'a, Result<(), CredentialError>> {
        Box::pin(async { Ok(()) })
    }
    fn delete<'a>(&'a self, _label: &'a str) -> BoxFuture<'a, Result<(), CredentialError>> {
        Box::pin(async { Ok(()) })
    }
    fn labels(&self) -> BoxFuture<'_, Vec<String>> {
        Box::pin(async { Vec::new() })
    }
}

fn repo() -> RepoRef {
    RepoRef {
        owner: "qlan".to_string(),
        repo: "mainframe".to_string(),
    }
}

fn issue_json(number: u64) -> serde_json::Value {
    serde_json::json!({
        "number": number, "title": "t", "body": "b", "labels": [],
        "state": "open", "html_url": "https://github.com/qlan/mainframe/issues/1",
        "updated_at": "2026-01-01T00:00:00Z",
    })
}

#[tokio::test]
async fn missing_credential_fails_without_reaching_the_network() {
    let store = Arc::new(MutableCredentialStore::default());
    let port = DaemonGitHubIssuesPort::with_base_url("http://127.0.0.1:0", store)
        .expect("the test port must build");

    let err = port.get_issue(&repo(), 1, "github").await.unwrap_err();

    assert_eq!(
        err.to_string(),
        "authentication failed: No GitHub credential is stored for 'github'. \
         Link the repository again to connect one."
    );
}

#[tokio::test]
async fn a_credential_connected_after_construction_resolves_on_the_next_call() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/qlan/mainframe/issues/1"))
        .and(header("authorization", "Bearer ghp_late"))
        .respond_with(ResponseTemplate::new(200).set_body_json(issue_json(1)))
        .mount(&server)
        .await;

    let store = Arc::new(MutableCredentialStore::default());
    let port = DaemonGitHubIssuesPort::with_base_url(server.uri(), store.clone())
        .expect("the test port must build");

    assert!(port.get_issue(&repo(), 1, "github").await.is_err());

    store.set("ghp_late");
    let issue = port.get_issue(&repo(), 1, "github").await.unwrap();
    assert_eq!(issue.number, 1);
    assert_eq!(issue.state, IssueState::Open);
}

#[tokio::test]
async fn not_found_maps_to_the_plugins_crate_error_variant() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/qlan/mainframe/issues/9"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    let store = Arc::new(MutableCredentialStore::default());
    store.set("tok");
    let port = DaemonGitHubIssuesPort::with_base_url(server.uri(), store)
        .expect("the test port must build");

    let err = port.get_issue(&repo(), 9, "github").await.unwrap_err();
    assert!(matches!(err, GitHubPortError::NotFound));
}

#[tokio::test]
async fn create_and_update_round_trip_through_the_mirrored_dtos() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/repos/qlan/mainframe/issues"))
        .respond_with(ResponseTemplate::new(200).set_body_json(issue_json(5)))
        .mount(&server)
        .await;
    Mock::given(method("PATCH"))
        .and(path("/repos/qlan/mainframe/issues/5"))
        .respond_with(ResponseTemplate::new(200).set_body_json(issue_json(5)))
        .mount(&server)
        .await;

    let store = Arc::new(MutableCredentialStore::default());
    store.set("tok");
    let port = DaemonGitHubIssuesPort::with_base_url(server.uri(), store)
        .expect("the test port must build");

    let created = port
        .create_issue(
            &repo(),
            CreateIssue {
                title: "t".to_string(),
                body: "b".to_string(),
                labels: vec![],
            },
            "github",
        )
        .await
        .unwrap();
    assert_eq!(created.number, 5);

    let updated = port
        .update_issue(
            &repo(),
            5,
            IssuePatch {
                title: Some("new title".to_string()),
                ..Default::default()
            },
            "github",
        )
        .await
        .unwrap();
    assert_eq!(updated.number, 5);
}
