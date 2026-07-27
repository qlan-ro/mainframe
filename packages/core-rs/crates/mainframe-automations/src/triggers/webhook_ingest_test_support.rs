//! Shared rig for the webhook ingest test modules (test-only): one
//! automation with a `hook-1` webhook trigger, a provisioned signing secret,
//! and the header/body builders every delivery case starts from.

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
use crate::store::{AutomationDb, AutomationStore, RunStore, WebhookStateStore};

use super::webhook::ensure_webhook_secret;
use super::webhook_ingest::{WebhookHeaders, WebhookProcessor};
use super::webhook_tests::sign;

pub(crate) const NOW_MS: i64 = 1_800_000_000_000;

pub(crate) struct IngestHarness {
    pub _dir: TempDir,
    pub automations: AutomationStore,
    pub runs: RunStore,
    pub state: WebhookStateStore,
    pub processor: WebhookProcessor,
    pub secret: String,
}

pub(crate) async fn harness(preset: Option<WebhookPreset>) -> IngestHarness {
    let dir = tempfile::tempdir().unwrap();
    let db = AutomationDb::open(dir.path().join("automations.db"))
        .await
        .unwrap();
    let automations = AutomationStore::new(db.clone());
    let runs = RunStore::new(db.clone());
    let state = WebhookStateStore::new(db);
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
                    registration: None,
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

    let processor =
        WebhookProcessor::new(automations.clone(), credentials, interpreter, state.clone());
    IngestHarness {
        _dir: dir,
        automations,
        runs,
        state,
        processor,
        secret,
    }
}

pub(crate) fn headers(h: &IngestHarness, body: &[u8], delivery: &str) -> WebhookHeaders {
    WebhookHeaders {
        signature: Some(sign(&h.secret, body)),
        github_event: Some("pull_request".to_string()),
        github_delivery: Some(delivery.to_string()),
        timestamp: None,
    }
}

pub(crate) fn opened_body() -> Vec<u8> {
    json!({"action": "opened", "pull_request": {"html_url": "https://x/pr/1"}})
        .to_string()
        .into_bytes()
}
