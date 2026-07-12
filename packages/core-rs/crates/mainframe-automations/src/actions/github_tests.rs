//! T7.1 — github connector over wiremock (base URL injectable): create_pr →
//! `{prUrl, prNumber}`, list_prs → `{prs: List<Record{url,title,number,
//! author}>}` (contract §5 camelCase), 401 failure names the credential
//! label the step used.

use std::collections::BTreeMap;

use serde_json::json;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::credentials::{CredentialKind, Credentials};
use crate::tokens::TokenValue;

use super::github::{GithubCreatePrAction, GithubListPrsAction};
use super::manifest::{ActionOutput, ActionOutputType};
use super::{Action, ActionCtx};

fn ctx(label: Option<&str>, token: Option<&str>) -> ActionCtx {
    ActionCtx {
        creds: token.map(|token| Credentials {
            kind: CredentialKind::Token,
            token: token.to_string(),
            extra: None,
        }),
        credential_label: label.map(str::to_string),
        idempotency_key: "run-1:step-1".to_string(),
        project_root: "/tmp".to_string(),
        worktree_path: None,
    }
}

#[tokio::test]
async fn create_pr_posts_and_maps_outputs() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/repos/qlan/mainframe/pulls"))
        .and(header("authorization", "Bearer gh-token"))
        .and(header("accept", "application/vnd.github+json"))
        .and(header("x-github-api-version", "2022-11-28"))
        .and(body_json(json!({
            "title": "feat: thing",
            "body": "does the thing",
            "head": "feat/thing",
            "base": "main",
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "html_url": "https://github.com/qlan/mainframe/pull/7",
            "number": 7,
        })))
        .expect(1)
        .mount(&server)
        .await;

    let outputs = GithubCreatePrAction::with_base_url(server.uri())
        .execute(
            &json!({
                "repo": "qlan/mainframe",
                "title": "feat: thing",
                "body": "does the thing",
                "head": "feat/thing",
                "base": "main",
            }),
            &ctx(Some("github"), Some("gh-token")),
        )
        .await
        .unwrap();

    assert_eq!(
        outputs["prUrl"],
        TokenValue::Text("https://github.com/qlan/mainframe/pull/7".to_string())
    );
    assert_eq!(outputs["prNumber"], TokenValue::Number(7.0));
    assert_eq!(
        outputs.keys().collect::<Vec<_>>(),
        vec!["prNumber", "prUrl"]
    );
}

#[tokio::test]
async fn create_pr_body_defaults_to_empty() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/repos/o/r/pulls"))
        .and(body_json(json!({
            "title": "t", "body": "", "head": "h", "base": "b",
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "html_url": "https://github.com/o/r/pull/1",
            "number": 1,
        })))
        .expect(1)
        .mount(&server)
        .await;

    GithubCreatePrAction::with_base_url(server.uri())
        .execute(
            &json!({"repo": "o/r", "title": "t", "head": "h", "base": "b"}),
            &ctx(Some("github"), Some("tok")),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn list_prs_searches_and_maps_records() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/search/issues"))
        .and(query_param("q", "is:pr state:open author:@me"))
        .and(header("authorization", "Bearer gh-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [
                {"html_url": "https://github.com/o/r/pull/1", "title": "one", "number": 1, "user": {"login": "doru"}},
                {"html_url": "https://github.com/o/r/pull/2", "title": "two", "number": 2, "user": {"login": "doru"}},
            ],
        })))
        .expect(1)
        .mount(&server)
        .await;

    let outputs = GithubListPrsAction::with_base_url(server.uri())
        .execute(&json!({}), &ctx(Some("github"), Some("gh-token")))
        .await
        .unwrap();

    let expected_first = TokenValue::Record(BTreeMap::from([
        (
            "url".to_string(),
            TokenValue::Text("https://github.com/o/r/pull/1".to_string()),
        ),
        ("title".to_string(), TokenValue::Text("one".to_string())),
        ("number".to_string(), TokenValue::Number(1.0)),
        ("author".to_string(), TokenValue::Text("doru".to_string())),
    ]));
    match &outputs["prs"] {
        TokenValue::List(items) => {
            assert_eq!(items.len(), 2);
            assert_eq!(items[0], expected_first);
        }
        other => panic!("prs is not a list: {other:?}"),
    }
}

#[tokio::test]
async fn unauthorized_failure_names_the_credential_label() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/search/issues"))
        .respond_with(ResponseTemplate::new(401).set_body_string("Bad credentials"))
        .mount(&server)
        .await;

    let err = GithubListPrsAction::with_base_url(server.uri())
        .execute(&json!({}), &ctx(Some("github"), Some("stale")))
        .await
        .unwrap_err();
    assert_eq!(
        err.0,
        "GitHub list PRs failed (401, credential 'github'): Bad credentials"
    );

    // Without a configured credential the failure says so instead.
    let err = GithubListPrsAction::with_base_url(server.uri())
        .execute(&json!({}), &ctx(None, None))
        .await
        .unwrap_err();
    assert_eq!(
        err.0,
        "GitHub list PRs failed (401, no credential configured): Bad credentials"
    );
}

#[tokio::test]
async fn non_auth_error_keeps_the_plain_form() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/repos/o/r/pulls"))
        .respond_with(ResponseTemplate::new(422).set_body_string("Validation Failed"))
        .mount(&server)
        .await;

    let err = GithubCreatePrAction::with_base_url(server.uri())
        .execute(
            &json!({"repo": "o/r", "title": "t", "head": "h", "base": "b"}),
            &ctx(Some("github"), Some("tok")),
        )
        .await
        .unwrap_err();
    assert_eq!(err.0, "GitHub create PR failed (422): Validation Failed");
}

#[tokio::test]
async fn strict_inputs_reject_unknown_and_missing_fields() {
    let action = GithubCreatePrAction::with_base_url("http://localhost:1".to_string());
    let err = action
        .execute(&json!({"repo": "o/r"}), &ctx(None, None))
        .await
        .unwrap_err();
    assert!(
        err.0.contains("invalid input for 'github.create_pr'"),
        "{}",
        err.0
    );

    let err = action
        .execute(
            &json!({"repo": "o/r", "title": "t", "head": "h", "base": "b", "extra": 1}),
            &ctx(None, None),
        )
        .await
        .unwrap_err();
    assert!(
        err.0.contains("invalid input for 'github.create_pr'"),
        "{}",
        err.0
    );
}

#[test]
fn manifests_match_contract() {
    let create = GithubCreatePrAction::new().manifest();
    assert_eq!(create.id, "github.create_pr");
    assert_eq!(
        create.outputs,
        vec![
            ActionOutput::new("prUrl", ActionOutputType::Text),
            ActionOutput::new("prNumber", ActionOutputType::Number),
        ]
    );
    assert!(!create.idempotent);
    assert_eq!(create.credential_label_hint, Some("github"));

    let list = GithubListPrsAction::new().manifest();
    assert_eq!(list.id, "github.list_prs");
    assert_eq!(
        list.outputs,
        vec![ActionOutput::new("prs", ActionOutputType::List)]
    );
    assert!(list.idempotent);
}
