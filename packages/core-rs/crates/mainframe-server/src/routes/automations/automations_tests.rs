//! CRUD + runs route tests (T9.3): WS4 envelope, A4 enabled toggle, 202 on
//! manual run, timeline + 32 KB truncation, A8 delete.

use std::time::Duration;

use axum::body::{Bytes, to_bytes};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use mainframe_types::automation::AutomationRunStatus;
use serde_json::{Value, json};

use crate::ctx::AppCtx;
use crate::routes::automations_test_support::{
    AutomationsHarness, ask_me_body, automations_ctx, notify_body,
};

use super::{
    cancel_run, create, get_one, get_run, list, list_runs, output_preview, remove, run_manually,
    set_enabled, update,
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

async fn create_ok(h: &AutomationsHarness, body: &Value) -> String {
    let (status, envelope) = read(create(State(h.ctx.clone()), bytes(body)).await).await;
    assert_eq!(status, StatusCode::OK);
    envelope["data"]["id"].as_str().unwrap().to_string()
}

async fn wait_status(h: &AutomationsHarness, run_id: &str, wanted: AutomationRunStatus) {
    for _ in 0..100 {
        let run = h.engine.get_run(run_id).await.unwrap();
        if run.as_ref().map(|r| r.status) == Some(wanted) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("run {run_id} never reached {wanted:?}");
}

#[tokio::test]
async fn all_handlers_503_without_the_engine() {
    let ctx = AppCtx::test_ctx();
    let (status, body) = read(list(State(ctx)).await).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["error"], "automation service not available");
}

#[tokio::test]
async fn create_list_get_round_trip() {
    let h = automations_ctx().await;
    let id = create_ok(&h, &notify_body("Daily")).await;

    let (status, body) = read(list(State(h.ctx.clone())).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
    assert_eq!(body["data"][0]["enabled"], json!(true));

    let (status, body) = read(get_one(State(h.ctx.clone()), Path(id)).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["name"], "Daily");
    assert_eq!(body["data"]["definition"]["steps"][0]["kind"], "notify");
}

#[tokio::test]
async fn create_rejects_invalid_definitions_with_structured_errors() {
    let h = automations_ctx().await;
    let mut body = notify_body("Broken");
    body["definition"]["steps"] = json!([]);
    let (status, envelope) = read(create(State(h.ctx.clone()), bytes(&body)).await).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(envelope["success"], json!(false));
    assert_eq!(envelope["errors"][0]["message"], "Add at least one step.");
    assert_eq!(envelope["errors"][0]["stepId"], Value::Null);
}

#[tokio::test]
async fn create_rejects_malformed_json_400() {
    let h = automations_ctx().await;
    let (status, _) = read(create(State(h.ctx.clone()), Bytes::from_static(b"{nope")).await).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn get_and_update_missing_automation_404() {
    let h = automations_ctx().await;
    let (status, body) = read(get_one(State(h.ctx.clone()), Path("ghost".into())).await).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "automation not found");

    let (status, _) = read(
        update(
            State(h.ctx.clone()),
            Path("ghost".into()),
            bytes(&notify_body("X")),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn update_replaces_the_definition() {
    let h = automations_ctx().await;
    let id = create_ok(&h, &notify_body("Before")).await;
    let (status, body) =
        read(update(State(h.ctx.clone()), Path(id), bytes(&notify_body("After"))).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["name"], "After");
}

#[tokio::test]
async fn patch_enabled_toggles_and_validates_the_body() {
    let h = automations_ctx().await;
    let id = create_ok(&h, &notify_body("Toggle")).await;

    let (status, body) = read(
        set_enabled(
            State(h.ctx.clone()),
            Path(id.clone()),
            bytes(&json!({ "enabled": false })),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["enabled"], json!(false));

    let (status, _) = read(
        set_enabled(
            State(h.ctx.clone()),
            Path(id),
            bytes(&json!({ "enabled": "yes" })),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn manual_run_202_then_run_view_with_timeline() {
    let h = automations_ctx().await;
    let id = create_ok(&h, &notify_body("Runner")).await;

    let (status, body) = read(run_manually(State(h.ctx.clone()), Path(id.clone())).await).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(body["success"], json!(true));
    let run_id = body["data"]["id"].as_str().unwrap().to_string();
    wait_status(&h, &run_id, AutomationRunStatus::Succeeded).await;

    let (status, body) = read(list_runs(State(h.ctx.clone()), Path(id)).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"][0]["status"], "succeeded");

    let (status, body) = read(get_run(State(h.ctx.clone()), Path(run_id)).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["run"]["status"], "succeeded");
    let timeline = body["data"]["timeline"].as_array().unwrap();
    assert_eq!(timeline.len(), 1);
    assert_eq!(timeline[0]["stepRef"], "n1");
    assert_eq!(timeline[0]["kind"], "notify");
    assert_eq!(timeline[0]["status"], "succeeded");
}

#[tokio::test]
async fn missing_run_404() {
    let h = automations_ctx().await;
    let (status, body) = read(get_run(State(h.ctx.clone()), Path("ghost".into())).await).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "run not found");
    let (status, _) = read(cancel_run(State(h.ctx.clone()), Path("ghost".into())).await).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn cancel_finalizes_a_waiting_run() {
    let h = automations_ctx().await;
    let id = create_ok(&h, &ask_me_body("Form")).await;
    let run = h.engine.run_manually(&id).await.unwrap();
    wait_status(&h, &run.id, AutomationRunStatus::Waiting).await;

    let (status, _) = read(cancel_run(State(h.ctx.clone()), Path(run.id.clone())).await).await;
    assert_eq!(status, StatusCode::OK);
    wait_status(&h, &run.id, AutomationRunStatus::Cancelled).await;
}

#[tokio::test]
async fn delete_cancels_active_runs_then_drops_rows() {
    let h = automations_ctx().await;
    let id = create_ok(&h, &ask_me_body("Form")).await;
    let run = h.engine.run_manually(&id).await.unwrap();
    wait_status(&h, &run.id, AutomationRunStatus::Waiting).await;

    let (status, _) = read(remove(State(h.ctx.clone()), Path(id.clone())).await).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = read(get_one(State(h.ctx.clone()), Path(id)).await).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Rows cascaded — the run view is gone too.
    let (status, _) = read(get_run(State(h.ctx.clone()), Path(run.id)).await).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[test]
fn output_preview_truncates_at_32k() {
    let mut outputs = serde_json::Map::new();
    outputs.insert("small".to_string(), json!("x"));
    assert_eq!(output_preview(Some(&outputs)).unwrap(), r#"{"small":"x"}"#);

    let mut big = serde_json::Map::new();
    big.insert("blob".to_string(), json!("y".repeat(40 * 1024)));
    let preview = output_preview(Some(&big)).unwrap();
    assert!(preview.starts_with("[truncated — "));
    assert!(preview.len() < 64);
    assert_eq!(output_preview(None), None);
}
