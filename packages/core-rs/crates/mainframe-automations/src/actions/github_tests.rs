//! T7.1 — github connector over wiremock (moved off the `gh` CLI by the
//! 2026-08-19 provider-connections plan): create_pr → `{prUrl, prNumber}`,
//! list_prs → `{prs: List<Record{url,title,number,author}>}` (contract §5
//! camelCase) via `/search/issues`, bearer auth from the stored `github`
//! credential, and the strict-input/repo-validation/401-naming behavior
//! ado.rs and notion.rs already cover for their own connectors.

use std::collections::BTreeMap;

use serde_json::json;
use wiremock::matchers::{bearer_token, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::credentials::{CredentialKind, Credentials};
use crate::tokens::TokenValue;

use super::github::{GithubCreatePrAction, GithubListPrsAction};
use super::manifest::{ActionAuth, ActionOutput, ActionOutputType};
use super::{Action, ActionCtx};

fn ctx(token: &str) -> ActionCtx {
    ActionCtx {
        creds: Some(Credentials {
            kind: CredentialKind::Token,
            token: token.to_string(),
            extra: None,
        }),
        credential_label: Some("github".to_string()),
        idempotency_key: "run-1:step-1".to_string(),
        project_root: "/tmp".to_string(),
        worktree_path: None,
    }
}

#[tokio::test]
async fn create_pr_posts_the_body_and_maps_outputs() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/repos/qlan/mainframe/pulls"))
        .and(bearer_token("ghp_1"))
        .and(header("accept", "application/vnd.github+json"))
        .and(wiremock::matchers::body_json(json!({
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
            &ctx("ghp_1"),
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
        .and(wiremock::matchers::body_json(
            json!({"title": "t", "body": "", "head": "h", "base": "b"}),
        ))
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
            &ctx("tok"),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn list_prs_searches_open_prs_and_maps_records() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/search/issues"))
        .and(query_param("q", "is:pr state:open author:@me"))
        .and(bearer_token("ghp_1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [
                {"html_url": "https://github.com/o/r/pull/1", "title": "one", "number": 1, "user": {"login": "doru"}},
                {"html_url": "https://github.com/o/r/pull/2", "title": "two", "number": 2, "user": {"login": "doru"}}
            ]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let outputs = GithubListPrsAction::with_base_url(server.uri())
        .execute(&json!({}), &ctx("ghp_1"))
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
async fn a_repo_that_could_reshape_the_endpoint_never_reaches_github() {
    let err = GithubCreatePrAction::with_base_url("http://localhost:1".to_string())
        .execute(
            &json!({"repo": "o/r/pulls/1", "title": "t", "head": "h", "base": "b"}),
            &ctx("tok"),
        )
        .await
        .unwrap_err();

    assert!(err.0.contains("must be 'owner/name'"), "{}", err.0);
}

#[tokio::test]
async fn strict_inputs_reject_unknown_and_missing_fields() {
    let action = GithubCreatePrAction::with_base_url("http://localhost:1".to_string());

    let err = action
        .execute(&json!({"repo": "o/r"}), &ctx("tok"))
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
            &ctx("tok"),
        )
        .await
        .unwrap_err();
    assert!(
        err.0.contains("invalid input for 'github.create_pr'"),
        "{}",
        err.0
    );
}

#[tokio::test]
async fn a_401_names_the_credential_label() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/search/issues"))
        .respond_with(ResponseTemplate::new(401).set_body_string("Bad credentials"))
        .mount(&server)
        .await;

    let err = GithubListPrsAction::with_base_url(server.uri())
        .execute(&json!({}), &ctx("stale"))
        .await
        .unwrap_err();
    assert_eq!(
        err.0,
        "GitHub list PRs failed (401, credential 'github'): Bad credentials"
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
    assert_eq!(create.auth, ActionAuth::Token);
    assert_eq!(create.credential_label_hint, Some("github"));

    let list = GithubListPrsAction::new().manifest();
    assert_eq!(list.id, "github.list_prs");
    assert_eq!(
        list.outputs,
        vec![ActionOutput::new("prs", ActionOutputType::List)]
    );
    assert!(list.idempotent);
    assert_eq!(list.auth, ActionAuth::Token);
    assert_eq!(list.credential_label_hint, Some("github"));
}
