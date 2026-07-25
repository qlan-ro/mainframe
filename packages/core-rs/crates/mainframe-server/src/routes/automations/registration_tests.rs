//! T7 — the webhook registration route. Registering arms the hook and hands
//! back the URL a user pastes into GitHub; the same registration then rides
//! along on every read of the automation.

use axum::body::{Bytes, to_bytes};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde_json::{Value, json};

use crate::routes::automations_test_support::{AutomationsHarness, automations_ctx};

use super::get_one;
use super::registration::register;

async fn read(resp: Response) -> (StatusCode, Value) {
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn webhook_body(name: &str) -> Value {
    json!({
        "name": name,
        "scope": "global",
        "definition": {
            "triggers": [ { "kind": "webhook", "id": "wt", "hookId": "hook-1" } ],
            "steps": [ { "id": "n1", "kind": "notify", "message": ["done"] } ]
        }
    })
}

async fn create_webhook_automation(h: &AutomationsHarness) -> String {
    let body = Bytes::from(serde_json::to_vec(&webhook_body("Deploy watch")).unwrap());
    let (status, envelope) = read(super::create(State(h.ctx.clone()), body).await).await;
    assert_eq!(status, StatusCode::OK);
    envelope["data"]["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn register_arms_the_hook_and_returns_the_local_ingest_url() {
    let h = automations_ctx().await;
    let id = create_webhook_automation(&h).await;

    let (status, body) =
        read(register(State(h.ctx.clone()), Path((id.clone(), "wt".to_string()))).await).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], json!(true));
    assert_eq!(body["data"]["hookId"], "hook-1");
    assert_eq!(
        body["data"]["url"],
        format!(
            "http://127.0.0.1:{}/api/automation-webhooks/hook-1",
            h.ctx.port
        ),
        "the daemon has no public tunnel — the URL is the local ingest endpoint"
    );
    assert_eq!(
        body["data"]["lastDeliveryAt"],
        Value::Null,
        "a present null is 'armed, never delivered'"
    );
}

#[tokio::test]
async fn register_404s_for_an_unknown_automation_or_trigger() {
    let h = automations_ctx().await;
    let id = create_webhook_automation(&h).await;

    let (status, body) = read(
        register(
            State(h.ctx.clone()),
            Path(("ghost".to_string(), "wt".to_string())),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "automation or webhook trigger not found");

    let (status, _) =
        read(register(State(h.ctx.clone()), Path((id, "nope".to_string()))).await).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn get_embeds_the_registration_only_once_the_hook_is_armed() {
    let h = automations_ctx().await;
    let id = create_webhook_automation(&h).await;

    let (_, body) = read(get_one(State(h.ctx.clone()), Path(id.clone())).await).await;
    assert_eq!(
        body["data"]["definition"]["triggers"][0]["registration"],
        Value::Null,
        "an absent registration is what 'not registered yet' looks like"
    );

    register(State(h.ctx.clone()), Path((id.clone(), "wt".to_string()))).await;

    let (_, body) = read(get_one(State(h.ctx.clone()), Path(id)).await).await;
    // The delivery stamp itself is pinned engine-side (service/registration_tests);
    // what the route owns is composing the URL and hanging it off the trigger.
    let registration = &body["data"]["definition"]["triggers"][0]["registration"];
    assert_eq!(registration["hookId"], "hook-1");
    assert_eq!(
        registration["url"],
        format!(
            "http://127.0.0.1:{}/api/automation-webhooks/hook-1",
            h.ctx.port
        )
    );
    assert_eq!(registration["lastDeliveryAt"], Value::Null);
}
