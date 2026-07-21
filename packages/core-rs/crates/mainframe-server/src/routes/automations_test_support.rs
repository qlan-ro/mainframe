//! Shared harness for the automation route tests: a real `AutomationsEngine`
//! over a tempdir (fake agent/notifier ports, broadcast-backed sink) inside
//! an `AppCtx`.

use std::sync::Arc;

use mainframe_automations::engine::BoxFuture;
use mainframe_automations::ports::{
    AgentHandle, AgentOutcome, AgentPort, AgentPortError, AgentRequest, Notification, Notifier,
    NotifyError, ProjectRegistry, SystemClock,
};
use mainframe_automations::{AutomationsConfig, AutomationsEngine, AutomationsPorts};
use serde_json::json;
use tempfile::TempDir;

use crate::automations_deps::DaemonEventSink;
use crate::ctx::AppCtx;

struct NoAgent;

impl AgentPort for NoAgent {
    fn start(&self, _request: AgentRequest) -> BoxFuture<'_, Result<AgentHandle, AgentPortError>> {
        Box::pin(async { Err(AgentPortError("no agent in route tests".to_string())) })
    }
    fn watch<'a>(
        &'a self,
        _chat_id: &'a str,
    ) -> BoxFuture<'a, Result<AgentOutcome, AgentPortError>> {
        Box::pin(async { Err(AgentPortError("no agent in route tests".to_string())) })
    }
    fn retry<'a>(
        &'a self,
        _chat_id: &'a str,
        _correction: &'a str,
    ) -> BoxFuture<'a, Result<AgentOutcome, AgentPortError>> {
        Box::pin(async { Err(AgentPortError("no agent in route tests".to_string())) })
    }
    fn cancel<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, Result<(), AgentPortError>> {
        Box::pin(async { Ok(()) })
    }
}

struct OkNotifier;

impl Notifier for OkNotifier {
    fn notify(&self, _notification: Notification) -> BoxFuture<'_, Result<(), NotifyError>> {
        Box::pin(async { Ok(()) })
    }
}

struct FixedProjects(String);

impl ProjectRegistry for FixedProjects {
    fn resolve_project_root<'a>(&'a self, _project_id: Option<&'a str>) -> BoxFuture<'a, String> {
        Box::pin(async move { self.0.clone() })
    }
}

pub(crate) struct AutomationsHarness {
    pub ctx: Arc<AppCtx>,
    pub engine: Arc<AutomationsEngine>,
    pub _dir: TempDir,
}

/// An `AppCtx::test_ctx` whose `automations` is a live fake-backed engine.
/// Events flow into `ctx.broadcast` via the production `DaemonEventSink`.
pub(crate) async fn automations_ctx() -> AutomationsHarness {
    let dir = tempfile::tempdir().unwrap();
    let base = AppCtx::test_ctx();
    let engine = AutomationsEngine::new(
        AutomationsConfig {
            db_path: dir.path().join("automations.db"),
            credentials_path: dir.path().join("automation-credentials.json"),
        },
        AutomationsPorts {
            agent: Arc::new(NoAgent),
            notifier: Arc::new(OkNotifier),
            events: Arc::new(DaemonEventSink::new(base.broadcast.clone())),
            projects: Arc::new(FixedProjects(dir.path().to_string_lossy().into_owned())),
            clock: Arc::new(SystemClock),
            event_source: None,
            registry: None,
        },
    )
    .await
    .unwrap();

    // AppCtx has no test constructor taking fields, so rebuild around the
    // engine (all handles are Arcs/Clones of the base ctx's).
    let ctx = Arc::new(AppCtx {
        db: base.db.clone(),
        git: base.git,
        services: base.services.clone(),
        broadcast: base.broadcast.clone(),
        ws_clients: base.ws_clients.clone(),
        adapter_registry: base.adapter_registry.clone(),
        background_tasks: base.background_tasks.clone(),
        chat_manager: None,
        launch_registry: None,
        tunnel_manager: None,
        lsp_manager: None,
        plugin_manager: None,
        automations: Some(engine.clone()),
        quota: None,
        data_dir: base.data_dir.clone(),
        version: base.version.clone(),
        port: base.port,
        auth_secret: None,
        resolved_path: base.resolved_path.clone(),
        tunnel_url: base.tunnel_url.clone(),
    });
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
