//! T8.3 — the webhook ingest pipeline end-to-end over a real store:
//! valid+matching starts a run with the payload Record + captures the
//! in-memory sample; bad signature 401s; preset mismatch 204s; a replayed
//! delivery id is a 200 no-op; stale deliveries drop; disabled automations
//! accept silently without a run (A7 + contract §4).

use std::sync::Arc;

use serde_json::json;
use tempfile::TempDir;

use crate::credentials::{CredentialStore, FileCredentialStore};
use crate::domain::{
    AutomationCreateInput, AutomationDefinition, AutomationScope, Trigger, WebhookPreset,
    WebhookTrigger,
};
use crate::engine::test_support::{CollectingSink, FakeClock, FakePorts};
use crate::engine::{Interpreter, InterpreterDeps};
use crate::store::{AutomationDb, AutomationStore, RunStore, RunTriggerKind};

use super::webhook::ensure_webhook_secret;
use super::webhook_ingest::{WebhookDecision, WebhookHeaders, WebhookProcessor};
use super::webhook_tests::sign;

const NOW_MS: i64 = 1_800_000_000_000;

struct IngestHarness {
    _dir: TempDir,
    automations: AutomationStore,
    runs: RunStore,
    processor: WebhookProcessor,
    secret: String,
}

async fn harness(preset: Option<WebhookPreset>) -> IngestHarness {
    let dir = tempfile::tempdir().unwrap();
    let db = AutomationDb::open(dir.path().join("automations.db"))
        .await
        .unwrap();
    let automations = AutomationStore::new(db.clone());
    let runs = RunStore::new(db);
    let credentials =
        Arc::new(FileCredentialStore::load(dir.path().join("automation-credentials.json")).await);
    let interpreter = Arc::new(Interpreter::new(InterpreterDeps {
        store: runs.clone(),
        ports: Arc::new(FakePorts::default()),
        events: Arc::new(CollectingSink::default()),
        clock: Arc::new(FakeClock),
        is_idempotent: None,
        agent_waits: None,
        on_finalized: None,
    }));

    automations
        .create(AutomationCreateInput {
            name: "pr watcher".to_string(),
            description: None,
            scope: AutomationScope::Global,
            project_id: None,
            definition: AutomationDefinition {
                triggers: vec![Trigger::Webhook(WebhookTrigger {
                    id: "wt".to_string(),
                    hook_id: "hook-1".to_string(),
                    preset,
                })],
                steps: vec![],
            },
        })
        .await
        .unwrap();
    ensure_webhook_secret(credentials.as_ref(), "hook-1")
        .await
        .unwrap();
    let secret = credentials.get("webhook:hook-1").await.unwrap().token;

    let processor = WebhookProcessor::new(automations.clone(), credentials, interpreter);
    IngestHarness {
        _dir: dir,
        automations,
        runs,
        processor,
        secret,
    }
}

fn headers(h: &IngestHarness, body: &[u8], delivery: &str) -> WebhookHeaders {
    WebhookHeaders {
        signature: Some(sign(&h.secret, body)),
        github_event: Some("pull_request".to_string()),
        github_delivery: Some(delivery.to_string()),
        timestamp: None,
    }
}

fn opened_body() -> Vec<u8> {
    json!({"action": "opened", "pull_request": {"html_url": "https://x/pr/1"}})
        .to_string()
        .into_bytes()
}

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
