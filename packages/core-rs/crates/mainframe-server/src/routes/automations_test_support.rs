//! Shared harness for the automation route tests: a real `AutomationsEngine`
//! over a tempdir (fake agent/notifier ports, broadcast-backed sink) inside
//! an `AppCtx`.

use std::sync::Arc;

use mainframe_automations::credentials::FileCredentialStore;
use mainframe_automations::ports::SystemClock;
use mainframe_automations::testkit::{FakeAgentPort, FakeNotifier, FixedProjects};
use mainframe_automations::{AutomationsConfig, AutomationsEngine, AutomationsPorts};
use serde_json::json;
use tempfile::TempDir;

use crate::automations_deps::DaemonEventSink;
use crate::ctx::AppCtx;

pub(crate) struct AutomationsHarness {
    pub ctx: Arc<AppCtx>,
    pub engine: Arc<AutomationsEngine>,
    pub _dir: TempDir,
}

/// An `AppCtx::test_ctx` whose `automations` is a live fake-backed engine.
/// Events flow into `ctx.core.broadcast` via the production `DaemonEventSink`.
pub(crate) async fn automations_ctx() -> AutomationsHarness {
    let dir = tempfile::tempdir().unwrap();
    let base = AppCtx::test_ctx();
    let credentials =
        Arc::new(FileCredentialStore::load(dir.path().join("automation-credentials.json")).await);
    let engine = AutomationsEngine::new(
        AutomationsConfig {
            db_path: dir.path().join("automations.db"),
            credentials,
        },
        AutomationsPorts {
            agent: Arc::new(FakeAgentPort::failing_start("no agent in route tests")),
            notifier: Arc::new(FakeNotifier::default()),
            events: Arc::new(DaemonEventSink::new(base.core.broadcast.clone())),
            projects: Arc::new(FixedProjects(dir.path().to_string_lossy().into_owned())),
            clock: Arc::new(SystemClock),
            event_source: None,
            registry: None,
        },
    )
    .await
    .unwrap();

    let mut ctx = base;
    Arc::get_mut(&mut ctx).unwrap().services.automations = Some(engine.clone());
    AutomationsHarness {
        ctx,
        engine,
        _dir: dir,
    }
}

/// A minimal valid create body: one notify step, no triggers.
pub(crate) fn notify_body(name: &str) -> serde_json::Value {
    json!({
        "name": name,
        "scope": "global",
        "definition": {
            "triggers": [],
            "steps": [ { "id": "n1", "kind": "notify", "message": ["done"] } ]
        }
    })
}

/// One ask_me step — parks the run `waiting` with a pending interaction.
pub(crate) fn ask_me_body(name: &str) -> serde_json::Value {
    json!({
        "name": name,
        "scope": "global",
        "definition": {
            "triggers": [],
            "steps": [ {
                "id": "form",
                "kind": "ask_me",
                "title": "Check-in",
                "fields": [ { "key": "mood", "type": "text", "required": false } ]
            } ]
        }
    })
}
