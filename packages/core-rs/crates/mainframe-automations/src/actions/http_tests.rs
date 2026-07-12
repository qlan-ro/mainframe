//! T6.5 — http.request over wiremock: method/url/body/header delivery,
//! bearer credential injection, non-2xx failure, `{status, body}`-only
//! outputs (contract §5 — no `result`).

use serde_json::json;
use wiremock::matchers::{body_json, body_string, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::credentials::{CredentialKind, Credentials};
use crate::tokens::TokenValue;

use super::http_action::HttpRequestAction;
use super::manifest::{ActionOutput, ActionOutputType};
use super::{Action, ActionCtx};

fn ctx() -> ActionCtx {
    ActionCtx {
        creds: None,
        idempotency_key: "run-1:step-1".to_string(),
        project_root: "/tmp".to_string(),
        worktree_path: None,
    }
}

fn ctx_with_token(token: &str) -> ActionCtx {
    ActionCtx {
        creds: Some(Credentials {
            kind: CredentialKind::Token,
            token: token.to_string(),
            extra: None,
        }),
        ..ctx()
    }
}

#[tokio::test]
async fn sends_method_json_body_and_idempotency_key() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/hook"))
        .and(header("content-type", "application/json"))
        .and(header("x-idempotency-key", "run-1:step-1"))
        .and(body_json(json!({"title": "hi"})))
        .respond_with(ResponseTemplate::new(200).set_body_string("created"))
        .expect(1)
        .mount(&server)
        .await;

    let outputs = HttpRequestAction::new()
        .execute(
            &json!({
                "method": "POST",
                "url": format!("{}/hook", server.uri()),
                "body": {"title": "hi"},
            }),
            &ctx(),
        )
        .await
        .unwrap();

    // Contract §5: status + body ONLY — no `result` output.
    assert_eq!(
        outputs.keys().collect::<Vec<_>>(),
        vec!["body", "status"],
        "outputs are exactly status and body"
    );
    assert_eq!(outputs["status"], TokenValue::Number(200.0));
    assert_eq!(outputs["body"], TokenValue::Text("created".to_string()));
}

#[tokio::test]
async fn method_defaults_to_get_and_string_body_is_verbatim() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/ping"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/raw"))
        .and(body_string("plain payload"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;

    let action = HttpRequestAction::new();
    let outputs = action
        .execute(&json!({"url": format!("{}/ping", server.uri())}), &ctx())
        .await
        .unwrap();
    assert_eq!(outputs["status"], TokenValue::Number(204.0));

    action
        .execute(
            &json!({
                "method": "PUT",
                "url": format!("{}/raw", server.uri()),
                "body": "plain payload",
            }),
            &ctx(),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn credential_injects_bearer_unless_author_set_authorization() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/auth"))
        .and(header("authorization", "Bearer sekret"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/custom-auth"))
        .and(header("authorization", "Basic abc"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;

    let action = HttpRequestAction::new();
    action
        .execute(
            &json!({"url": format!("{}/auth", server.uri())}),
            &ctx_with_token("sekret"),
        )
        .await
        .unwrap();

    // An author-set Authorization header wins over the credential.
    action
        .execute(
            &json!({
                "url": format!("{}/custom-auth", server.uri()),
                "headers": {"Authorization": "Basic abc"},
            }),
            &ctx_with_token("sekret"),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn non_2xx_fails_with_status_and_body_snippet() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/boom"))
        .respond_with(ResponseTemplate::new(500).set_body_string("kaboom"))
        .mount(&server)
        .await;

    let url = format!("{}/boom", server.uri());
    let err = HttpRequestAction::new()
        .execute(&json!({"url": url}), &ctx())
        .await
        .unwrap_err();
    assert_eq!(err.0, format!("HTTP 500 from {url}: kaboom"));
}

#[tokio::test]
async fn invalid_inputs_fail_before_sending() {
    let action = HttpRequestAction::new();

    let err = action
        .execute(&json!({"url": "not a url"}), &ctx())
        .await
        .unwrap_err();
    assert!(
        err.0.contains("invalid input for 'http.request'"),
        "{}",
        err.0
    );

    let err = action
        .execute(
            &json!({"url": "http://localhost:1/x", "timeoutMs": 300000}),
            &ctx(),
        )
        .await
        .unwrap_err();
    assert!(err.0.contains("timeoutMs"), "{}", err.0);

    let err = action
        .execute(&json!({"url": "http://localhost:1/x", "body": 42}), &ctx())
        .await
        .unwrap_err();
    assert!(err.0.contains("body"), "{}", err.0);

    let err = action
        .execute(
            &json!({"url": "http://localhost:1/x", "verb": "GET"}),
            &ctx(),
        )
        .await
        .unwrap_err();
    assert!(
        err.0.contains("invalid input for 'http.request'"),
        "{}",
        err.0
    );
}

#[test]
fn manifest_matches_contract() {
    let manifest = HttpRequestAction::new().manifest();
    assert_eq!(manifest.id, "http.request");
    assert_eq!(
        manifest.outputs,
        vec![
            ActionOutput::new("status", ActionOutputType::Number),
            ActionOutput::new("body", ActionOutputType::Text),
        ]
    );
    assert!(!manifest.idempotent);
}
