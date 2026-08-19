//! Every connector must send a `User-Agent`. GitHub rejects requests without
//! one (403 "Request forbidden by administrative rules"), and the wiremock
//! suites elsewhere in this module never asserted the header, so a bare
//! `reqwest::Client::new()` shipped undetected. One file covers every
//! connector that speaks HTTP, because the trap is per-client, not per-API.

use std::collections::BTreeMap;

use serde_json::json;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::credentials::{CredentialKind, Credentials};

use super::ado::AdoCreateItemAction;
use super::github::GithubCreatePrAction;
use super::http_action::HttpRequestAction;
use super::notion::NotionAddRowAction;
use super::{Action, ActionCtx, USER_AGENT};

fn ctx() -> ActionCtx {
    ActionCtx {
        creds: Some(Credentials {
            kind: CredentialKind::Token,
            token: "token".to_string(),
            extra: None,
        }),
        credential_label: Some("label".to_string()),
        idempotency_key: "run-1:step-1".to_string(),
        project_root: "/tmp".to_string(),
        worktree_path: None,
    }
}

/// Mounts a catch-all that only matches when the User-Agent is ours, so a
/// missing header fails the action rather than silently passing.
async fn server_requiring_user_agent(status: u16, body: serde_json::Value) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(header("user-agent", USER_AGENT))
        .respond_with(ResponseTemplate::new(status).set_body_json(body))
        .expect(1)
        .mount(&server)
        .await;
    server
}

#[tokio::test]
async fn notion_add_row_sends_a_user_agent() {
    let server = server_requiring_user_agent(200, json!({"url": "https://notion.so/page"})).await;

    let result = NotionAddRowAction::with_base_url(server.uri())
        .execute(&json!({"databaseId": "db-1", "Name": "row"}), &ctx())
        .await;

    assert!(result.is_ok(), "notion without a User-Agent: {result:?}");
}

#[tokio::test]
async fn ado_create_item_sends_a_user_agent() {
    let server =
        server_requiring_user_agent(200, json!({"id": 42, "_links": {"html": {"href": "u"}}}))
            .await;

    let result = AdoCreateItemAction::with_base_url(server.uri())
        .execute(
            &json!({
                "org": "org",
                "project": "proj",
                "type": "Bug",
                "title": "it broke",
            }),
            &ctx(),
        )
        .await;

    assert!(result.is_ok(), "ado without a User-Agent: {result:?}");
}

#[tokio::test]
async fn github_create_pr_sends_a_user_agent() {
    let server = server_requiring_user_agent(
        201,
        json!({"html_url": "https://github.com/o/r/pull/1", "number": 1}),
    )
    .await;

    let result = GithubCreatePrAction::with_base_url(server.uri())
        .execute(
            &json!({"repo": "o/r", "title": "t", "head": "h", "base": "b"}),
            &ctx(),
        )
        .await;

    assert!(result.is_ok(), "github without a User-Agent: {result:?}");
}

#[tokio::test]
async fn http_request_sends_a_user_agent() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/thing"))
        .and(header("user-agent", USER_AGENT))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"ok": true})))
        .expect(1)
        .mount(&server)
        .await;

    let outputs = HttpRequestAction::new()
        .execute(
            &json!({"method": "GET", "url": format!("{}/thing", server.uri())}),
            &ctx(),
        )
        .await;

    assert!(outputs.is_ok(), "http without a User-Agent: {outputs:?}");
    let _: BTreeMap<_, _> = outputs.unwrap();
}
