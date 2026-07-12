//! Webhook ingress route tests (T9.3, A7): signature → preset predicate →
//! staleness → replay dedup → run, with the exact status matrix.

use std::time::Duration;

use axum::body::{Bytes, to_bytes};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::Response;
use hmac::{Hmac, Mac};
use serde_json::{Value, json};
use sha2::Sha256;

use crate::routes::automations_test_support::{AutomationsHarness, automations_ctx};

use super::ingest;

const SECRET: &str = "hook-secret";

async fn read(resp: Response) -> (StatusCode, Value) {
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn sign(body: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(SECRET.as_bytes()).unwrap();
    mac.update(body);
    format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
}

fn headers(signature: Option<&str>, delivery: Option<&str>) -> HeaderMap {
    let mut map = HeaderMap::new();
    if let Some(signature) = signature {
        map.insert(
            "x-hub-signature-256",
            HeaderValue::from_str(signature).unwrap(),
        );
    }
    if let Some(delivery) = delivery {
        map.insert(
            "x-github-delivery",
            HeaderValue::from_str(delivery).unwrap(),
        );
    }
    map
}

/// Automation with one webhook trigger (+ optional preset) and a notify step.
async fn webhook_automation(h: &AutomationsHarness, hook_id: &str, preset: Option<&str>) -> String {
    let mut trigger = json!({ "kind": "webhook", "id": "t1", "hookId": hook_id });
    if let Some(preset) = preset {
        trigger["preset"] = json!(preset);
    }
    let input = json!({
        "name": "Hooked",
        "scope": "global",
        "definition": {
            "triggers": [trigger],
            "steps": [ { "id": "n1", "kind": "notify", "message": ["fired"] } ]
        }
    });
    let created = h
        .engine
        .create(serde_json::from_value(input).unwrap())
        .await
        .unwrap();
    h.engine
        .set_credential(&format!("webhook:{hook_id}"), SECRET.to_string())
        .await
        .unwrap();
    created.id
}

async fn run_count(h: &AutomationsHarness, automation_id: &str) -> usize {
    h.engine.list_runs(automation_id).await.unwrap().len()
}

#[tokio::test]
async fn unknown_hook_404() {
    let h = automations_ctx().await;
    let (status, body) = read(
        ingest(
            State(h.ctx.clone()),
            Path("nope".into()),
            headers(None, None),
            Bytes::from_static(b"{}"),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "unknown webhook");
}

#[tokio::test]
async fn bad_signature_401() {
    let h = automations_ctx().await;
    webhook_automation(&h, "h1", None).await;
    let (status, body) = read(
        ingest(
            State(h.ctx.clone()),
            Path("h1".into()),
            headers(Some("sha256=deadbeef"), Some("d-1")),
            Bytes::from_static(b"{}"),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "invalid signature");
}

#[tokio::test]
async fn valid_delivery_starts_a_run_and_a_replay_is_a_200_noop() {
    let h = automations_ctx().await;
    let automation_id = webhook_automation(&h, "h1", None).await;
    let body = br#"{"event":"push"}"#;

    let (status, envelope) = read(
        ingest(
            State(h.ctx.clone()),
            Path("h1".into()),
            headers(Some(&sign(body)), Some("d-1")),
            Bytes::from_static(body),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(envelope, json!({ "success": true }));
    // Give the spawned advance a beat, then assert exactly one run.
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(run_count(&h, &automation_id).await, 1);

    // A7 — the same delivery id replays as a 200 no-op, not a second run.
    let (status, _) = read(
        ingest(
            State(h.ctx.clone()),
            Path("h1".into()),
            headers(Some(&sign(body)), Some("d-1")),
            Bytes::from_static(body),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(run_count(&h, &automation_id).await, 1);
}

#[tokio::test]
async fn preset_mismatch_is_a_204_with_no_run() {
    let h = automations_ctx().await;
    let automation_id = webhook_automation(&h, "h2", Some("github_pr_opened")).await;
    let body = br#"{"event":"pull_request","action":"closed","id":"77"}"#;
    let (status, _) = read(
        ingest(
            State(h.ctx.clone()),
            Path("h2".into()),
            headers(Some(&sign(body)), Some("d-2")),
            Bytes::from_static(body),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(run_count(&h, &automation_id).await, 0);
}

#[tokio::test]
async fn stale_delivery_is_dropped_with_204() {
    let h = automations_ctx().await;
    let automation_id = webhook_automation(&h, "h3", None).await;
    let stale_ms = chrono::Utc::now().timestamp_millis() - 11 * 60 * 1000;
    let payload = format!(r#"{{"event":"push","timestamp":{stale_ms},"id":"d-3"}}"#);
    let (status, _) = read(
        ingest(
            State(h.ctx.clone()),
            Path("h3".into()),
            headers(Some(&sign(payload.as_bytes())), None),
            Bytes::from(payload.clone()),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(run_count(&h, &automation_id).await, 0);
}

#[tokio::test]
async fn missing_delivery_id_400() {
    let h = automations_ctx().await;
    webhook_automation(&h, "h4", None).await;
    let body = br#"{"event":"push"}"#;
    let (status, envelope) = read(
        ingest(
            State(h.ctx.clone()),
            Path("h4".into()),
            headers(Some(&sign(body)), None),
            Bytes::from_static(body),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(envelope["error"].as_str().unwrap().contains("delivery id"));
}

#[tokio::test]
async fn invalid_json_with_a_valid_signature_400() {
    let h = automations_ctx().await;
    webhook_automation(&h, "h5", None).await;
    let body = b"not json";
    let (status, envelope) = read(
        ingest(
            State(h.ctx.clone()),
            Path("h5".into()),
            headers(Some(&sign(body)), Some("d-5")),
            Bytes::from_static(body),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(envelope["error"], "invalid JSON payload");
}
