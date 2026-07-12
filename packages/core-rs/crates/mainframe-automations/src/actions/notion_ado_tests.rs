//! T7.2 — notion.add_row + ado.create_item over wiremock. Notion maps
//! explicit key/value params to rich_text properties (no column-picker
//! endpoint yet — contract §9); a date param arrives pre-rendered (the
//! ⟨Today⟩ chip is substituted before the action runs). ADO creates a work
//! item via a JSON-patch body and PAT basic auth.

use serde_json::json;
use wiremock::matchers::{basic_auth, body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::credentials::{CredentialKind, Credentials};
use crate::tokens::TokenValue;

use super::ado::AdoCreateItemAction;
use super::manifest::{ActionOutput, ActionOutputType};
use super::notion::NotionAddRowAction;
use super::{Action, ActionCtx};

fn ctx(label: &str, token: &str) -> ActionCtx {
    ActionCtx {
        creds: Some(Credentials {
            kind: CredentialKind::Token,
            token: token.to_string(),
            extra: None,
        }),
        credential_label: Some(label.to_string()),
        idempotency_key: "run-1:step-1".to_string(),
        project_root: "/tmp".to_string(),
        worktree_path: None,
    }
}

#[tokio::test]
async fn notion_maps_key_values_to_rich_text_properties() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/pages"))
        .and(header("authorization", "Bearer notion-token"))
        .and(header("notion-version", "2022-06-28"))
        .and(header("content-type", "application/json"))
        .and(body_json(json!({
            "parent": {"database_id": "db-1"},
            "properties": {
                // The ⟨Today⟩ chip was rendered to a plain date string before
                // the action ran — it rides as rich_text like every value.
                "Date": {"rich_text": [{"text": {"content": "2026-07-12"}}]},
                "Mood": {"rich_text": [{"text": {"content": "good"}}]},
            },
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "url": "https://notion.so/page-1",
        })))
        .expect(1)
        .mount(&server)
        .await;

    let outputs = NotionAddRowAction::with_base_url(server.uri())
        .execute(
            &json!({"databaseId": "db-1", "Date": "2026-07-12", "Mood": "good"}),
            &ctx("notion", "notion-token"),
        )
        .await
        .unwrap();

    assert_eq!(
        outputs["pageUrl"],
        TokenValue::Text("https://notion.so/page-1".to_string())
    );
    assert_eq!(outputs.keys().collect::<Vec<_>>(), vec!["pageUrl"]);
}

#[tokio::test]
async fn notion_rejects_non_string_extra_values_and_names_credential_on_401() {
    let action = NotionAddRowAction::with_base_url("http://localhost:1".to_string());
    let err = action
        .execute(
            &json!({"databaseId": "db-1", "Count": 3}),
            &ctx("notion", "t"),
        )
        .await
        .unwrap_err();
    assert!(
        err.0.contains("invalid input for 'notion.add_row'"),
        "{}",
        err.0
    );

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/pages"))
        .respond_with(ResponseTemplate::new(401).set_body_string("unauthorized"))
        .mount(&server)
        .await;
    let err = NotionAddRowAction::with_base_url(server.uri())
        .execute(&json!({"databaseId": "db-1"}), &ctx("notion", "stale"))
        .await
        .unwrap_err();
    assert_eq!(
        err.0,
        "Notion add row failed (401, credential 'notion'): unauthorized"
    );
}

#[tokio::test]
async fn ado_posts_json_patch_and_maps_outputs() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/my-org/my-proj/_apis/wit/workitems/$Task"))
        .and(basic_auth("", "ado-pat"))
        .and(header("content-type", "application/json-patch+json"))
        .and(body_json(json!([
            {"op": "add", "path": "/fields/System.Title", "value": "Fix the flaky test"},
            {"op": "add", "path": "/fields/System.Description", "value": "details"},
        ])))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": 4242,
            "_links": {"html": {"href": "https://dev.azure.com/my-org/my-proj/_workitems/edit/4242"}},
        })))
        .expect(1)
        .mount(&server)
        .await;

    let outputs = AdoCreateItemAction::with_base_url(server.uri())
        .execute(
            &json!({
                "org": "my-org",
                "project": "my-proj",
                "type": "Task",
                "title": "Fix the flaky test",
                "description": "details",
            }),
            &ctx("ado", "ado-pat"),
        )
        .await
        .unwrap();

    assert_eq!(outputs["workItemId"], TokenValue::Number(4242.0));
    assert_eq!(
        outputs["url"],
        TokenValue::Text("https://dev.azure.com/my-org/my-proj/_workitems/edit/4242".to_string())
    );
    assert_eq!(
        outputs.keys().collect::<Vec<_>>(),
        vec!["url", "workItemId"]
    );
}

#[tokio::test]
async fn ado_description_defaults_empty_and_strict_input_rejects_unknown() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/o/p/_apis/wit/workitems/$Bug"))
        .and(body_json(json!([
            {"op": "add", "path": "/fields/System.Title", "value": "t"},
            {"op": "add", "path": "/fields/System.Description", "value": ""},
        ])))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": 1,
            "_links": {"html": {"href": "https://dev.azure.com/o/p/_workitems/edit/1"}},
        })))
        .expect(1)
        .mount(&server)
        .await;

    let action = AdoCreateItemAction::with_base_url(server.uri());
    action
        .execute(
            &json!({"org": "o", "project": "p", "type": "Bug", "title": "t"}),
            &ctx("ado", "pat"),
        )
        .await
        .unwrap();

    let err = action
        .execute(
            &json!({"org": "o", "project": "p", "type": "Bug", "title": "t", "nope": 1}),
            &ctx("ado", "pat"),
        )
        .await
        .unwrap_err();
    assert!(
        err.0.contains("invalid input for 'ado.create_item'"),
        "{}",
        err.0
    );
}

#[tokio::test]
async fn ado_failure_names_credential_label_on_401() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/o/p/_apis/wit/workitems/$Bug"))
        .respond_with(ResponseTemplate::new(401).set_body_string("PAT expired"))
        .mount(&server)
        .await;

    let err = AdoCreateItemAction::with_base_url(server.uri())
        .execute(
            &json!({"org": "o", "project": "p", "type": "Bug", "title": "t"}),
            &ctx("ado", "pat"),
        )
        .await
        .unwrap_err();
    assert_eq!(
        err.0,
        "Azure DevOps create item failed (401, credential 'ado'): PAT expired"
    );
}

#[test]
fn manifests_match_contract() {
    let notion = NotionAddRowAction::new().manifest();
    assert_eq!(notion.id, "notion.add_row");
    assert_eq!(
        notion.outputs,
        vec![ActionOutput::new("pageUrl", ActionOutputType::Text)]
    );
    assert!(!notion.idempotent);
    assert_eq!(notion.credential_label_hint, Some("notion"));

    let ado = AdoCreateItemAction::new().manifest();
    assert_eq!(ado.id, "ado.create_item");
    assert_eq!(
        ado.outputs,
        vec![
            ActionOutput::new("workItemId", ActionOutputType::Number),
            ActionOutput::new("url", ActionOutputType::Text),
        ]
    );
    assert!(!ado.idempotent);
    assert_eq!(ado.credential_label_hint, Some("ado"));
}
