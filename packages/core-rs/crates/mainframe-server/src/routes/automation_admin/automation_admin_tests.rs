//! Admin route tests (T9.3): interactions respond flow, action catalog,
//! credential CRUD (labels/kind only — never secret material).

use std::time::Duration;

use axum::body::{Bytes, to_bytes};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde_json::{Value, json};

use crate::routes::automations_test_support::{AutomationsHarness, ask_me_body, automations_ctx};

use super::{
    delete_credential, get_credential, list_actions, list_credentials, list_interactions,
    put_credential, respond,
};

async fn read(resp: Response) -> (StatusCode, Value) {
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn bytes(value: &Value) -> Bytes {
    Bytes::from(serde_json::to_vec(value).unwrap())
}

async fn pending_interaction_id(h: &AutomationsHarness) -> String {
    for _ in 0..100 {
        let pending = h.engine.list_pending_interactions().await.unwrap();
        if let Some(first) = pending.first() {
            return first.id.clone();
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("no interaction ever went pending");
}

#[tokio::test]
async fn interactions_list_and_respond_flow() {
    let h = automations_ctx().await;
    let created = h
        .engine
        .create(serde_json::from_value(ask_me_body("Form")).unwrap())
        .await
        .unwrap();
    h.engine.run_manually(&created.id).await.unwrap();
    let interaction_id = pending_interaction_id(&h).await;

    let (status, body) = read(list_interactions(State(h.ctx.clone())).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"][0]["status"], "pending");
    assert_eq!(body["data"][0]["fields"][0]["key"], "mood");

    let (status, _) = read(
        respond(
            State(h.ctx.clone()),
            Path(interaction_id.clone()),
            bytes(&json!({ "response": { "mood": "good" } })),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Second answer → 409 (already answered).
    let (status, body) = read(
        respond(
            State(h.ctx.clone()),
            Path(interaction_id),
            bytes(&json!({ "response": { "mood": "bad" } })),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body["error"].as_str().unwrap().contains("already answered"));
}

#[tokio::test]
async fn respond_unknown_interaction_404_and_bad_body_400() {
    let h = automations_ctx().await;
    let (status, _) = read(
        respond(
            State(h.ctx.clone()),
            Path("ghost".into()),
            bytes(&json!({ "response": {} })),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _) = read(
        respond(
            State(h.ctx.clone()),
            Path("ghost".into()),
            bytes(&json!({ "nope": true })),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn action_catalog_lists_builtins_and_connectors_without_mcp() {
    let h = automations_ctx().await;
    let (status, body) = read(list_actions(State(h.ctx.clone())).await).await;
    assert_eq!(status, StatusCode::OK);
    let ids: Vec<&str> = body["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["id"].as_str().unwrap())
        .collect();
    assert!(ids.contains(&"run_command"));
    assert!(ids.contains(&"files.read"));
    assert!(ids.contains(&"github.create_pr"));
    assert!(ids.contains(&"notion.add_row"));
    // Launch catalog returns no mcp:* entries (contract §9).
    assert!(!ids.iter().any(|id| id.starts_with("mcp:")));
}

#[tokio::test]
async fn credentials_round_trip_never_exposes_the_token() {
    let h = automations_ctx().await;
    let (status, _) = read(
        put_credential(
            State(h.ctx.clone()),
            Path("github".into()),
            bytes(&json!({ "token": "tok_secret" })),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = read(list_credentials(State(h.ctx.clone())).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["labels"], json!(["github"]));

    let (status, body) =
        read(get_credential(State(h.ctx.clone()), Path("github".into())).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"], json!({ "label": "github", "kind": "token" }));
    assert!(!body.to_string().contains("tok_secret"));

    let (status, _) =
        read(delete_credential(State(h.ctx.clone()), Path("github".into())).await).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = read(get_credential(State(h.ctx.clone()), Path("github".into())).await).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn reserved_webhook_labels_are_rejected_by_the_label_rule() {
    let h = automations_ctx().await;
    for handler_status in [
        read(get_credential(State(h.ctx.clone()), Path("webhook:h1".into())).await)
            .await
            .0,
        read(
            put_credential(
                State(h.ctx.clone()),
                Path("webhook:h1".into()),
                bytes(&json!({ "token": "x" })),
            )
            .await,
        )
        .await
        .0,
        read(delete_credential(State(h.ctx.clone()), Path("webhook:h1".into())).await)
            .await
            .0,
    ] {
        assert_eq!(handler_status, StatusCode::BAD_REQUEST);
    }
}
