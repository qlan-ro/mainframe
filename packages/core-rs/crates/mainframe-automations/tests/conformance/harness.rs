//! Conformance harness (T10.2/T10.3): builds the real `AutomationsEngine` over
//! a tempfile `automations.db` with the fake ports + recording action
//! registry, loads the six canonical fixtures by relative path (never
//! re-authored), and drives runs to completion. Restart scenarios rebuild a
//! fresh engine over the SAME db/credentials paths, mirroring a daemon
//! crash-and-reboot.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use hmac::{Hmac, Mac};
use serde_json::{Map, Value};
use sha2::Sha256;
use tempfile::TempDir;

use mainframe_automations::domain::AutomationCreateInput;
use mainframe_automations::store::{InteractionRecord, RunRecord, RunStatus};
use mainframe_automations::triggers::{WebhookDecision, WebhookHeaders};
use mainframe_automations::{AutomationsConfig, AutomationsEngine, AutomationsPorts};

pub use crate::fake_actions::{ActionRecorder, FakeActions, build_actions};
pub use crate::fakes::{CollectingSink, FakeAgentPort, FakeClock, FakeNotifier, FixedProjects};

/// A single engine over a tempdir, with handles to every fake for assertions.
pub struct Rig {
    pub engine: Arc<AutomationsEngine>,
    pub agent: Arc<FakeAgentPort>,
    pub notifier: Arc<FakeNotifier>,
    pub sink: Arc<CollectingSink>,
    pub actions: FakeActions,
    pub db: PathBuf,
    pub creds: PathBuf,
    _dir: TempDir,
}

pub fn fixture_path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../types/fixtures/automations")
        .join(format!("{name}.json"))
}

/// Deserialize a canonical fixture into the create-input the facade takes.
pub fn load_fixture(name: &str) -> AutomationCreateInput {
    let path = fixture_path(name);
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path:?}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse fixture {name}: {e}"))
}

/// Build an engine over explicit paths so a second engine can adopt the same
/// store (restart parity); pass a fresh `FakeActions`/agent per engine so a
/// scenario can assert per-engine invocation counts.
pub async fn build_engine(
    db: &Path,
    creds: &Path,
    agent: Arc<FakeAgentPort>,
    notifier: Arc<FakeNotifier>,
    sink: Arc<CollectingSink>,
    actions: &FakeActions,
) -> Arc<AutomationsEngine> {
    let root = db.parent().unwrap().to_string_lossy().into_owned();
    AutomationsEngine::new(
        AutomationsConfig {
            db_path: db.to_path_buf(),
            credentials_path: creds.to_path_buf(),
        },
        AutomationsPorts {
            agent,
            notifier,
            events: sink,
            projects: Arc::new(FixedProjects(root)),
            clock: Arc::new(FakeClock),
            event_source: None,
            registry: Some(actions.registry.clone()),
        },
    )
    .await
    .unwrap()
}

impl Rig {
    /// A ready engine whose agent step (if any) auto-completes with `final_text`.
    pub async fn completing(final_text: &str) -> Rig {
        Rig::with_agent(FakeAgentPort::completing(final_text)).await
    }

    /// A ready engine whose agent step blocks until `agent.complete(...)`.
    pub async fn manual_agent() -> Rig {
        Rig::with_agent(FakeAgentPort::manual()).await
    }

    async fn with_agent(agent: FakeAgentPort) -> Rig {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("automations.db");
        let creds = dir.path().join("automation-credentials.json");
        let agent = Arc::new(agent);
        let notifier = Arc::new(FakeNotifier::default());
        let sink = Arc::new(CollectingSink::default());
        let actions = build_actions();
        let engine = build_engine(
            &db,
            &creds,
            agent.clone(),
            notifier.clone(),
            sink.clone(),
            &actions,
        )
        .await;
        Rig {
            engine,
            agent,
            notifier,
            sink,
            actions,
            db,
            creds,
            _dir: dir,
        }
    }

    /// Create the fixture automation and start a manual run; returns its id.
    pub async fn start(&self, fixture: &str) -> String {
        let created = self.engine.create(load_fixture(fixture)).await.unwrap();
        self.engine.run_manually(&created.id).await.unwrap().id
    }

    pub async fn wait(&self, run_id: &str, status: RunStatus) -> RunRecord {
        wait_status(&self.engine, run_id, status).await
    }

    pub async fn pending(&self) -> InteractionRecord {
        let pending = self.engine.list_pending_interactions().await.unwrap();
        assert_eq!(pending.len(), 1, "expected exactly one pending interaction");
        pending.into_iter().next().unwrap()
    }

    pub async fn respond(&self, interaction_id: &str, answers: Value) {
        let payload = answers.as_object().unwrap().clone();
        self.engine.respond(interaction_id, payload).await.unwrap();
    }

    pub fn recorded(&self, action_id: &str) -> Vec<Value> {
        self.actions.recorder.calls_for(action_id)
    }
}

pub async fn wait_status(engine: &AutomationsEngine, run_id: &str, status: RunStatus) -> RunRecord {
    for _ in 0..600 {
        if let Some(run) = engine.get_run(run_id).await.unwrap()
            && run.status == status
        {
            return run;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let actual = engine.get_run(run_id).await.unwrap().map(|r| r.status);
    panic!("run {run_id} never reached {status:?} (last: {actual:?})");
}

/// Poll until a fake action has been invoked at least `count` times.
pub async fn wait_action(recorder: &ActionRecorder, action_id: &str, count: usize) {
    for _ in 0..600 {
        if recorder.count(action_id) >= count {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("action {action_id} never reached {count} call(s)");
}

/// GitHub's `sha256=<lowercase-hex>` HMAC-SHA256 over the raw body.
pub fn sign(secret: &str, body: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(body);
    format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
}

/// Sign + deliver a webhook body (JSON) to the engine and return the decision.
pub async fn deliver_webhook(
    engine: &AutomationsEngine,
    hook_id: &str,
    secret: &str,
    body: &Value,
    delivery_id: &str,
) -> WebhookDecision {
    let raw = serde_json::to_vec(body).unwrap();
    let headers = WebhookHeaders {
        signature: Some(sign(secret, &raw)),
        github_event: Some("pull_request".to_string()),
        github_delivery: Some(delivery_id.to_string()),
        timestamp: None,
    };
    engine.process_webhook(hook_id, &headers, &raw).await
}

pub fn answers(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}
