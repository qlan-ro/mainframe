//! Production port impls for the automations engine (T9.2) — the
//! `DaemonChatDeps` inversion applied to `mainframe-automations`: the engine
//! crate defines the traits, this module implements them over the live
//! ChatManager / PushService / broadcast bus, and `build_automations_engine`
//! assembles the engine at daemon boot (mirrors `build_chat_manager`).

mod agent;
mod bridges;
mod chat_port;

use std::path::Path;
use std::sync::Arc;

use mainframe_automations::engine::BoxFuture;
use mainframe_automations::ports::{ProjectRegistry, SystemClock};
use mainframe_automations::{AutomationsConfig, AutomationsEngine, AutomationsPorts};
use mainframe_chat::chat_manager::ChatManager;
use mainframe_services::push::PushService;
use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast;

use crate::ctx::GitFactory;
use crate::db::Db;

pub use agent::DaemonAgentPort;
pub use bridges::{DaemonEventSink, DaemonEventSource, DaemonNotifier, map_automation_event};
pub use chat_port::{AgentChatPort, ChatManagerPort};

/// `ActionCtx.projectRoot` resolution (Node service.resolveProjectRoot): the
/// automation's own project when set, else the workspace's first project,
/// else the daemon cwd.
pub struct DbProjectRegistry {
    db: Db,
}

impl DbProjectRegistry {
    pub fn new(db: Db) -> Self {
        Self { db }
    }
}

impl ProjectRegistry for DbProjectRegistry {
    fn resolve_project_root<'a>(&'a self, project_id: Option<&'a str>) -> BoxFuture<'a, String> {
        let id = project_id.map(str::to_string);
        Box::pin(async move {
            let resolved = self
                .db
                .call(move |d| {
                    if let Some(id) = &id
                        && let Some(project) = d.projects.get(id)?
                    {
                        return Ok(Some(project.path));
                    }
                    Ok(d.projects.list()?.into_iter().next().map(|p| p.path))
                })
                .await
                .ok()
                .flatten();
            resolved.unwrap_or_else(|| {
                std::env::current_dir()
                    .map(|cwd| cwd.to_string_lossy().into_owned())
                    .unwrap_or_else(|_| ".".to_string())
            })
        })
    }
}

/// Assemble the production engine from the daemon's live collaborators.
/// Called once at boot, after `build_chat_manager`. A construction failure
/// (unwritable data dir) logs and returns `None` — the daemon serves
/// everything else and the automation routes answer 503 (Node parity:
/// "AutomationService failed to start — continuing without automations").
pub async fn build_automations_engine(
    db: Db,
    chats: Arc<ChatManager>,
    broadcast: broadcast::Sender<DaemonEvent>,
    push: Arc<PushService>,
    git: GitFactory,
    data_dir: &Path,
) -> Option<Arc<AutomationsEngine>> {
    let chat_port = Arc::new(ChatManagerPort::new(chats));
    let agent = Arc::new(DaemonAgentPort::new(
        chat_port,
        broadcast.clone(),
        db.clone(),
        git,
    ));
    let ports = AutomationsPorts {
        agent,
        notifier: Arc::new(DaemonNotifier::new(broadcast.clone(), push)),
        events: Arc::new(DaemonEventSink::new(broadcast.clone())),
        projects: Arc::new(DbProjectRegistry::new(db)),
        clock: Arc::new(SystemClock),
        event_source: Some(DaemonEventSource::spawn(broadcast.subscribe())),
    };
    let config = AutomationsConfig {
        db_path: data_dir.join("automations.db"),
        credentials_path: data_dir.join("automation-credentials.json"),
    };
    match AutomationsEngine::new(config, ports).await {
        Ok(engine) => Some(engine),
        Err(err) => {
            tracing::error!(
                error = %err,
                "failed to build the automations engine — continuing without automations"
            );
            None
        }
    }
}

#[cfg(test)]
mod tests;

// PORT STATUS: packages/core/src/index.ts (AutomationService wiring) +
// automations/agent-port.ts
// confidence: high
// todos: 0
// notes: engine start()/reconcile is T10.1; boot only constructs + stores the
//        handle in AppCtx and stop()s it in the ordered shutdown.
