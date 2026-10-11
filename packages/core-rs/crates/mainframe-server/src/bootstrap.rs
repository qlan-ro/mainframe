use std::future::Future;
use std::sync::{Arc, RwLock};

use crate::ctx::{AppCtx, GitFactory, Services};
use crate::db::Db;
use crate::wiring::plugin_host_db::DaemonPluginHostDb;
use crate::{
    RegistryLaunchStopper, RegistryScopeTunnelStopper, build_app, build_automations_engine,
    build_chat_manager, build_orchestration, spawn_broadcast_pump,
};
use mainframe_adapter_api::AdapterRegistry;
use mainframe_adapter_claude::adapter::ClaudeAdapter;
use mainframe_adapter_codex::CodexAdapter;
use mainframe_background_tasks::liveness::{LivenessDeps, start_liveness_scheduler};
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::{bridge::spawn_workflow_run_bridge, store::ClaudeWorkflowStore};
use mainframe_launch::{
    BroadcastFn, ChildRegistryPort, FileChildRegistry, LaunchRegistry, PortTunnelRegistry,
    ResolveCloudflaredDeps, TunnelManager, TunnelManagerOptions, TunnelStartOptions,
    default_sweep_deps, resolve_cloudflared_path, shutdown_launches_and_tunnels,
    sweep_stray_children,
};
use mainframe_lsp::{LspManager, LspRegistry};
use mainframe_plugins::manager::PluginManagerDeps;
use mainframe_plugins::{EmitSink, GitHubIssues, PluginManager};
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::files::FileWatcherService;
use mainframe_services::push::PushService;
use mainframe_services::quota::{
    ClaudeQuotaScheduler, ClaudeQuotaSchedulerDeps, QuotaManager, QuotaManagerDeps,
};
use mainframe_types::events::DaemonEvent;
use mainframe_types::seam_error::SeamError;
use tokio::sync::broadcast;
use tracing::info;

use crate::wiring::events::spawn_task_event_bridge;
use crate::wiring::quota::register_quota_sources;
use crate::wiring::reconcile::{spawn_reconcile, spawn_worktree_backfill};
use crate::wiring::refresh::DaemonRefreshDeps;
use crate::wiring::{builtin_plugins, e2e_mock, github_issues_port};
use mainframe_runtime::config::{BootPaths, MainframeConfig};

mod assemble;
mod lifecycle;
mod resources;
pub use lifecycle::ReadyDaemon;

#[derive(Debug, thiserror::Error)]
pub enum BootError {
    #[error(transparent)]
    Context(#[from] crate::ctx::BuildError),
    #[error("listener: {0}")]
    Listener(#[from] std::io::Error),
    #[error("database: {0}")]
    Database(#[from] mainframe_db::DbError),
}

pub struct Bootstrap {
    config: MainframeConfig,
    paths: BootPaths,
    resolved_path: mainframe_runtime::ResolvedPath,
    auth_secret: Option<String>,
    version: String,
}

pub struct BoundBootstrap {
    input: Bootstrap,
    listener: tokio::net::TcpListener,
    db: Db,
}

impl Bootstrap {
    pub fn new(
        config: MainframeConfig,
        paths: BootPaths,
        resolved_path: mainframe_runtime::ResolvedPath,
        auth_secret: Option<String>,
        version: String,
    ) -> Self {
        Self {
            config,
            paths,
            resolved_path,
            auth_secret,
            version,
        }
    }

    pub async fn bind(self) -> Result<BoundBootstrap, BootError> {
        info!(data_dir = %self.paths.data_dir.display(), "data directory");
        let paths = self.paths.clone();
        let (listener, db) =
            crate::wiring::startup::bind_before_database(self.config.port, move || {
                Db::spawn(move || {
                    mainframe_db::DatabaseManager::new(&paths.db_path, &paths.legacy_db_path)
                })
            })
            .await?;
        Ok(BoundBootstrap {
            input: self,
            listener,
            db: db?,
        })
    }
}

impl BoundBootstrap {
    pub async fn build(self) -> Result<Daemon, BootError> {
        let resources = resources::Resources::new(&self).await;
        assemble::assemble(self, resources).await
    }
}

pub struct Daemon {
    pub ctx: Arc<AppCtx>,
    listener: tokio::net::TcpListener,
    config: MainframeConfig,
    handles: DaemonHandles,
}

struct DaemonHandles {
    child_registry: Arc<dyn ChildRegistryPort>,
    quota_manager: Arc<QuotaManager>,
    orchestration_events: tokio::task::JoinHandle<()>,
    keepalive: broadcast::Receiver<DaemonEvent>,
}
