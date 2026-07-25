//! T8.3 — the webhook ingest pipeline end-to-end over a real store:
//! valid+matching starts a run with the payload Record + captures the
//! in-memory sample; bad signature 401s; preset mismatch 204s; a replayed
//! delivery id is a 200 no-op; stale deliveries drop; disabled automations
//! accept silently without a run (A7 + contract §4). T7 adds the durable
//! delivery stamp the editor's registration panel reads.

use serde_json::json;

use crate::domain::WebhookPreset;
use crate::store::RunTriggerKind;

use super::webhook_ingest::WebhookDecision;
use super::webhook_ingest_test_support::{NOW_MS, harness, headers, opened_body};
use super::webhook_tests::sign;

#[tokio::test]
async fn valid_matching_delivery_starts_a_run_with_payload_and_sample() {
    let h = harness(Some(WebhookPreset::GithubPrOpened)).await;
    let body = opened_body();

    let decision = h
        .processor
        .process("hook-1", &headers(&h, &body, "d-1"), &body, NOW_MS)
        .await;
    let WebhookDecision::Accepted {
        run_id: Some(run_id),
    } = decision
    else {
        panic!("expected an accepted run, got {decision:?}");
    };

    let run = h.runs.get_run(&run_id).await.unwrap().unwrap();
    assert_eq!(run.checkpoint.trigger.kind, RunTriggerKind::Webhook);
    assert_eq!(run.checkpoint.trigger.trigger_id.as_deref(), Some("wt"));
    let payload = run.checkpoint.trigger.payload.clone().unwrap();
    assert_eq!(payload["action"], "opened");
    assert_eq!(
        payload["event"], "pull_request",
        "X-GitHub-Event is merged into the payload"
    );
    assert_eq!(payload["pull_request"]["html_url"], "https://x/pr/1");

    // The latest matching payload is sampled in-memory (R3).
    let automation_id = h.automations.list().await.unwrap()[0].id.clone();
    assert_eq!(
        h.processor.latest_sample(&automation_id, "wt").unwrap(),
        payload
    );
}

#[tokio::test]
async fn bad_signature_is_rejected_before_anything_else() {
    let h = harness(Some(WebhookPreset::GithubPrOpened)).await;
    let body = opened_body();
    let mut hdrs = headers(&h, &body, "d-1");
    hdrs.signature = Some(sign("wrong-secret", &body));

    let decision = h.processor.process("hook-1", &hdrs, &body, NOW_MS).await;
    assert_eq!(decision, WebhookDecision::InvalidSignature);

    let automation_id = h.automations.list().await.unwrap()[0].id.clone();
    assert!(
        h.runs
            .list_runs(&automation_id, 10)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(h.processor.latest_sample(&automation_id, "wt").is_none());
}

#[tokio::test]
async fn an_unsigned_delivery_is_rejected() {
    let h = harness(Some(WebhookPreset::GithubPrOpened)).await;
    let body = opened_body();
    let mut hdrs = headers(&h, &body, "d-1");
    hdrs.signature = None;

    let decision = h.processor.process("hook-1", &hdrs, &body, NOW_MS).await;
    assert_eq!(
        decision,
        WebhookDecision::InvalidSignature,
        "signing is mandatory — an armed hook accepts nothing it cannot verify"
    );
    assert_eq!(
        h.state.last_delivery_at("hook-1").await.unwrap(),
        None,
        "an unsigned body must not be able to claim the hook is wired up"
    );
}

#[tokio::test]
async fn unknown_hook_and_invalid_json_are_typed_rejections() {
    let h = harness(None).await;
    let body = opened_body();

    let decision = h
        .processor
        .process("nope", &headers(&h, &body, "d-1"), &body, NOW_MS)
        .await;
    assert_eq!(decision, WebhookDecision::UnknownHook);

    let garbage = b"not json {";
    let decision = h
        .processor
        .process("hook-1", &headers(&h, garbage, "d-1"), garbage, NOW_MS)
        .await;
    assert_eq!(decision, WebhookDecision::InvalidJson);
}

#[tokio::test]
async fn preset_mismatch_is_a_no_run_204() {
    let h = harness(Some(WebhookPreset::GithubPrMerged)).await;
    // A `closed` without merged:true must not fire PR-merged.
    let body = json!({"action": "closed", "pull_request": {"merged": false}})
        .to_string()
        .into_bytes();

    let decision = h
        .processor
        .process("hook-1", &headers(&h, &body, "d-1"), &body, NOW_MS)
        .await;
    assert_eq!(decision, WebhookDecision::PresetMismatch);

    let automation_id = h.automations.list().await.unwrap()[0].id.clone();
    assert!(
        h.runs
            .list_runs(&automation_id, 10)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn replayed_delivery_id_is_a_silent_no_op() {
    let h = harness(Some(WebhookPreset::GithubPrOpened)).await;
    let body = opened_body();

    let first = h
        .processor
        .process("hook-1", &headers(&h, &body, "d-1"), &body, NOW_MS)
        .await;
    assert!(matches!(
        first,
        WebhookDecision::Accepted { run_id: Some(_) }
    ));

    // Same X-GitHub-Delivery again: dedup on `wt|d-1` → 200 no-op (A7).
    let replay = h
        .processor
        .process("hook-1", &headers(&h, &body, "d-1"), &body, NOW_MS)
        .await;
    assert_eq!(replay, WebhookDecision::Duplicate);

    let automation_id = h.automations.list().await.unwrap()[0].id.clone();
    assert_eq!(h.runs.list_runs(&automation_id, 10).await.unwrap().len(), 1);

    // A fresh delivery id fires again.
    let second = h
        .processor
        .process("hook-1", &headers(&h, &body, "d-2"), &body, NOW_MS)
        .await;
    assert!(matches!(
        second,
        WebhookDecision::Accepted { run_id: Some(_) }
    ));
}

#[tokio::test]
async fn stale_deliveries_drop_and_missing_timestamps_are_accepted() {
    let h = harness(Some(WebhookPreset::GithubPrOpened)).await;
    let body = opened_body();

    // 11 minutes old — beyond the A7 window.
    let mut stale = headers(&h, &body, "d-1");
    stale.timestamp = Some(((NOW_MS - 11 * 60_000) / 1000).to_string());
    let decision = h.processor.process("hook-1", &stale, &body, NOW_MS).await;
    assert_eq!(decision, WebhookDecision::StaleDelivery);

    // No derivable timestamp: accepted — the permanent delivery-id dedup is
    // the replay defense.
    let decision = h
        .processor
        .process("hook-1", &headers(&h, &body, "d-2"), &body, NOW_MS)
        .await;
    assert!(matches!(
        decision,
        WebhookDecision::Accepted { run_id: Some(_) }
    ));
}

#[tokio::test]
async fn missing_delivery_id_is_malformed() {
    let h = harness(None).await;
    let body = json!({"action": "opened"}).to_string().into_bytes();
    let mut hdrs = headers(&h, &body, "");
    hdrs.github_delivery = None;

    let decision = h.processor.process("hook-1", &hdrs, &body, NOW_MS).await;
    assert_eq!(decision, WebhookDecision::MissingDeliveryId);
}

#[tokio::test]
async fn disabled_automation_accepts_silently_without_a_run() {
    let h = harness(Some(WebhookPreset::GithubPrOpened)).await;
    let automation_id = h.automations.list().await.unwrap()[0].id.clone();
    h.automations
        .set_enabled(&automation_id, false)
        .await
        .unwrap();

    let body = opened_body();
    let decision = h
        .processor
        .process("hook-1", &headers(&h, &body, "d-1"), &body, NOW_MS)
        .await;
    assert_eq!(
        decision,
        WebhookDecision::Accepted { run_id: None },
        "the wire response must not leak that the automation is disabled"
    );
    assert!(
        h.runs
            .list_runs(&automation_id, 10)
            .await
            .unwrap()
            .is_empty()
    );
    // The sample still captures — the editor can use it once re-enabled.
    assert!(h.processor.latest_sample(&automation_id, "wt").is_some());
}

#[tokio::test]
async fn a_verified_delivery_stamps_the_hook_and_a_forged_one_does_not() {
    let h = harness(Some(WebhookPreset::GithubPrOpened)).await;
    let body = opened_body();

    let mut forged = headers(&h, &body, "d-0");
    forged.signature = Some(sign("wrong-secret", &body));
    h.processor.process("hook-1", &forged, &body, NOW_MS).await;
    assert_eq!(
        h.state.last_delivery_at("hook-1").await.unwrap(),
        None,
        "an unsigned body must not be able to claim the hook is wired up"
    );

    // A delivery the preset rejects still proves GitHub is reaching us, which
    // is the only question the registration panel asks.
    let mismatch = json!({"action": "closed"}).to_string().into_bytes();
    h.processor
        .process("hook-1", &headers(&h, &mismatch, "d-1"), &mismatch, NOW_MS)
        .await;
    assert_eq!(
        h.state.last_delivery_at("hook-1").await.unwrap().as_deref(),
        Some("2027-01-15T08:00:00+00:00")
    );
}
