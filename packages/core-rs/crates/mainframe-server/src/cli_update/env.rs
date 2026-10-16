//! The manager's view of the outside world — executable resolution, the
//! network, processes, the adapter registry, the websocket — and the daemon's
//! implementation of it.

use std::path::Path;
use std::sync::Arc;

use mainframe_adapter_api::AdapterRegistry;
use mainframe_adapter_api::resolve_executable::{ResolverDeps, resolve_adapter_executable};
use mainframe_runtime::ResolvedPath;
use mainframe_types::BoxFuture;
use mainframe_types::cli_update::ProviderCliStatus;
use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast;

use super::install::{self, CommandSpec, Distribution, InstallPlan, LatestSource, Located};
use super::run::{OutputSink, RunOutcome};
use crate::ctx::DefaultRunner;
use crate::db::Db;

/// A located, runnable CLI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Probe {
    pub path: String,
    pub version: Option<String>,
    pub plan: InstallPlan,
}

pub trait CliUpdateEnv: Send + Sync {
    /// Ids of the registered adapters.
    fn adapter_ids(&self) -> Vec<String>;
    /// The adapter's executable, its `--version`, and how it was installed;
    /// `None` when no working executable is found.
    fn locate(&self, adapter_id: String, dist: Distribution) -> BoxFuture<'_, Option<Probe>>;
    fn fetch_latest(&self, source: LatestSource) -> BoxFuture<'_, Option<String>>;
    fn run_update(&self, command: CommandSpec, sink: OutputSink) -> BoxFuture<'_, RunOutcome>;
    /// Re-probe the adapter so its version, capabilities and model catalog
    /// reflect the binary now on disk.
    fn reload_adapter(&self, adapter_id: String) -> BoxFuture<'_, ()>;
    fn emit(&self, status: ProviderCliStatus);
    fn now_ms(&self) -> i64;
}

pub struct DaemonCliUpdateEnv {
    pub db: Db,
    pub registry: Arc<AdapterRegistry>,
    pub resolved_path: ResolvedPath,
    pub broadcast: broadcast::Sender<DaemonEvent>,
    pub http: reqwest::Client,
}

impl CliUpdateEnv for DaemonCliUpdateEnv {
    fn adapter_ids(&self) -> Vec<String> {
        self.registry
            .get_all()
            .iter()
            .map(|adapter| adapter.id().to_string())
            .collect()
    }

    fn locate(&self, adapter_id: String, dist: Distribution) -> BoxFuture<'_, Option<Probe>> {
        Box::pin(async move {
            let runner = DefaultRunner::new(self.resolved_path.clone());
            let resolved = resolve_adapter_executable(
                &adapter_id,
                &ResolverDeps {
                    settings: &self.db,
                    run: &runner,
                    path: &self.resolved_path,
                },
            )
            .await;
            if !resolved.valid {
                return None;
            }
            let path = resolved.path;
            let located = Located {
                canonical: tokio::fs::canonicalize(&path)
                    .await
                    .map_or_else(|_| path.clone(), |p| p.to_string_lossy().into_owned()),
                path: path.clone(),
                home: dirs::home_dir().map(|home| home.to_string_lossy().into_owned()),
            };
            let plan = tokio::task::spawn_blocking(move || {
                install::plan(&dist, &located, &|candidate| Path::new(candidate).is_file())
            })
            .await
            .ok()?;
            Some(Probe {
                path,
                version: resolved.version,
                plan,
            })
        })
    }

    fn fetch_latest(&self, source: LatestSource) -> BoxFuture<'_, Option<String>> {
        Box::pin(async move { super::latest::fetch_latest(&self.http, &source).await })
    }

    fn run_update(&self, command: CommandSpec, sink: OutputSink) -> BoxFuture<'_, RunOutcome> {
        Box::pin(super::run::run_update(command, &self.resolved_path, sink))
    }

    fn reload_adapter(&self, adapter_id: String) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            if let Err(error) = self.registry.force_refresh(&adapter_id).await {
                tracing::warn!(error = %error, adapter_id, "adapter refresh after CLI update failed");
            }
        })
    }

    fn emit(&self, status: ProviderCliStatus) {
        // Fails only when no websocket client is connected.
        /* expected */
        let _ = self
            .broadcast
            .send(DaemonEvent::ProviderCliUpdated { status });
    }

    fn now_ms(&self) -> i64 {
        mainframe_types::time::now_ms()
    }
}

impl super::CliUpdateManager {
    /// The manager over the daemon's registry, settings, `PATH` and websocket.
    pub fn for_daemon(core: &crate::ctx::CoreCtx) -> Arc<Self> {
        let http = mainframe_runtime::http::builder()
            .user_agent(concat!("mainframe-daemon/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "CLI update HTTP client fell back to defaults");
                reqwest::Client::new()
            });
        Arc::new(Self::new(Arc::new(DaemonCliUpdateEnv {
            db: core.db.clone(),
            registry: core.adapter_registry.clone(),
            resolved_path: core.resolved_path.clone(),
            broadcast: core.broadcast.clone(),
            http,
        })))
    }
}
