//! `AppCtx` — the Arc-shared application context every route module and the WS
//! layer read.

use mainframe_types::sync::RwLockExt as _;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use mainframe_adapter_api::AdapterRegistry;
use mainframe_automations::AutomationsEngine;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_chat::chat_manager::ChatManager;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_launch::{LaunchRegistry, PortTunnelRegistry, TunnelManager};
use mainframe_lsp::LspManager;
use mainframe_orchestration::OrchestrationService;
use mainframe_plugins::PluginManager;
use mainframe_runtime::ResolvedPath;
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::files::FileWatcherService;
use mainframe_services::push::PushService;
use mainframe_services::quota::QuotaService;
use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast;

use crate::acp_ws::FacadeHub;
use crate::db::Db;
use crate::websocket::WsClients;

/// The default process runner, as the `Runner` trait resolve-executable
/// injects. `resolve_adapter_executable` (the settings `resolvedExecutable`
/// enrichment and the daemon's refresh deps) takes `&dyn Runner`; this is the
/// single production impl over `default_run` (spawn + 5s default timeout).
///
/// Carries the boot-resolved login-shell `PATH` so version probes find CLIs
/// outside the packaged app's bare `PATH`.
#[derive(Default)]
pub struct DefaultRunner {
    pub path: Option<ResolvedPath>,
}

impl DefaultRunner {
    #[must_use]
    pub fn new(path: ResolvedPath) -> Self {
        Self { path: Some(path) }
    }
}

impl mainframe_adapter_api::resolve_executable::Runner for DefaultRunner {
    fn run(
        &self,
        cmd: String,
        args: Vec<String>,
        timeout_ms: Option<u64>,
    ) -> mainframe_adapter_api::BoxFuture<'_, mainframe_adapter_api::RunResult> {
        let path = self.path.clone();
        Box::pin(async move {
            mainframe_adapter_api::resolve_executable::default_run(
                &cmd,
                &args,
                timeout_ms,
                path.as_deref(),
            )
            .await
        })
    }
}

/// Stateless per-project `GitService` factory (the contract's `git` handle).
/// `GitService::for_project` carries no shared state, and per-project write
/// serialization uses the module-level lock in `mainframe_git`, so this is a
/// zero-sized entry point — route modules call `ctx.core.git.for_project(path)`.
#[derive(Clone, Copy, Default)]
pub struct GitFactory;

impl GitFactory {
    /// Build a `GitService` scoped to `project_path`; route handlers call this
    /// per request.
    pub fn for_project(&self, project_path: impl Into<String>) -> mainframe_git::GitService {
        mainframe_git::GitService::for_project(project_path)
    }
}

/// The cross-cutting daemon service handles. `commands` and
/// `provider-config` are free functions over the db, not stored handles, so they
/// have no field here — route modules call them with `ctx.core.db`.
#[derive(Clone)]
pub struct Services {
    pub attachments: Arc<AttachmentStore>,
    pub push: Arc<PushService>,
    pub watcher: Arc<FileWatcherService>,
}

pub struct AppCtx {
    pub core: CoreCtx,
    pub chat: ChatCtx,
    pub infra: InfraCtx,
    pub services: ServicesCtx,
}

pub struct CoreCtx {
    pub db: Db,
    pub git: GitFactory,
    pub broadcast: broadcast::Sender<DaemonEvent>,
    pub adapter_registry: Arc<AdapterRegistry>,
    pub background_tasks: Arc<BackgroundTaskTracker>,
    pub claude_workflows: Arc<ClaudeWorkflowStore>,
    pub data_dir: PathBuf,
    pub version: String,
    pub port: u16,
    pub auth_secret: Option<String>,
    pub resolved_path: ResolvedPath,
}

pub struct ChatCtx {
    pub chat_manager: Arc<ChatManager>,
    pub facade_hub: Arc<FacadeHub>,
    pub facade_heartbeat_interval_ms: u64,
    pub orchestration: Arc<OrchestrationService>,
}

pub struct InfraCtx {
    pub launch_registry: Arc<LaunchRegistry>,
    pub tunnel_manager: Arc<TunnelManager>,
    pub port_tunnels: Arc<PortTunnelRegistry>,
    pub lsp_manager: Arc<LspManager>,
    pub plugin_manager: Arc<PluginManager>,
    pub ws_clients: WsClients,
    pub tunnel_url: Arc<RwLock<Option<String>>>,
}

pub struct ServicesCtx {
    pub attachments: Arc<AttachmentStore>,
    pub push: Arc<PushService>,
    pub watcher: Arc<FileWatcherService>,
    pub automations: Option<Arc<AutomationsEngine>>,
    pub quota: Arc<dyn QuotaService>,
}

mod builder;
pub use builder::AppCtxBuilder;

impl AppCtx {
    pub fn builder(db: Db, data_dir: PathBuf) -> AppCtxBuilder {
        AppCtxBuilder::new(db, data_dir)
    }
    pub async fn require_chat(
        &self,
        id: &str,
    ) -> Result<mainframe_types::chat::Chat, crate::respond::ApiError> {
        let id = id.to_string();
        self.core
            .db
            .call(move |db| db.chats.get(&id))
            .await?
            .ok_or_else(crate::respond::ApiError::chat_not_found)
    }

    pub async fn require_project(
        &self,
        id: &str,
    ) -> Result<mainframe_types::chat::Project, crate::respond::ApiError> {
        let id = id.to_string();
        self.core
            .db
            .call(move |db| db.projects.get(&id))
            .await?
            .ok_or_else(crate::respond::ApiError::project_not_found)
    }

    /// Read the current `/health` tunnel URL.
    pub fn tunnel_url(&self) -> Option<String> {
        self.infra.tunnel_url.read_recover().clone()
    }

    /// The mutator the tunnel routes call after start/stop.
    pub fn set_tunnel_url(&self, url: Option<String>) {
        *self.infra.tunnel_url.write_recover() = url;
    }

    pub async fn resolve_scope(
        &self,
        project_id: &str,
        chat_id: Option<&str>,
    ) -> Result<mainframe_services::workspace::ScopePath, mainframe_services::workspace::ScopeError>
    {
        let pid = project_id.to_owned();
        let cid = chat_id.map(str::to_owned);
        self.core
            .db
            .call(move |db| {
                Ok(mainframe_services::workspace::resolve_scope(
                    db,
                    &pid,
                    cid.as_deref(),
                ))
            })
            .await?
    }

    pub async fn effective_path(&self, project_id: &str, chat_id: Option<&str>) -> Option<String> {
        match self.resolve_scope(project_id, chat_id).await {
            Ok(scope) => Some(scope.path),
            Err(error) => {
                tracing::debug!(%error, "scope unavailable");
                None
            }
        }
    }
}

#[cfg(test)]
impl AppCtx {
    pub(crate) fn test_ctx() -> Arc<AppCtx> {
        crate::chat_test_support::test_ctx()
    }
    pub(crate) fn test_ctx_with_chat_manager() -> Arc<AppCtx> {
        Self::test_ctx()
    }
    pub(crate) fn test_ctx_with_orchestration() -> Arc<AppCtx> {
        Self::test_ctx()
    }
}

#[cfg(test)]
mod poisoned_lock_tests {
    use super::*;

    #[tokio::test]
    async fn tunnel_url_write_survives_a_poisoned_lock() {
        let ctx = AppCtx::test_ctx();
        std::thread::scope(|scope| {
            assert!(
                scope
                    .spawn(|| {
                        let _guard = ctx.infra.tunnel_url.write().unwrap();
                        panic!("poison tunnel URL");
                    })
                    .join()
                    .is_err()
            );
        });

        ctx.set_tunnel_url(Some("https://example.test".to_string()));
        assert_eq!(ctx.tunnel_url().as_deref(), Some("https://example.test"));
    }
}
