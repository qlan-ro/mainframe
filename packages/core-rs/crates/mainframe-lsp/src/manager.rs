//! One language-server child per `(projectId, language)`: single-flight spawn,
//! the idle reaper, and the graceful shutdown (the LSP `shutdown` request and
//! `exit` notification, then SIGTERM and SIGKILL).

use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use dashmap::DashMap;
use tokio::sync::watch;

use crate::client::LspClient;
use crate::registry::{LspRegistry, ResolvedCommand};

mod handle;
mod lifecycle;
mod spawn;

pub(crate) use handle::ClientSlot;
pub use handle::LspServerHandle;

#[derive(Debug, thiserror::Error)]
pub enum LspError {
    #[error("project path {path} is not accessible: {source}")]
    PathNotFound {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("no language server is configured for '{0}'")]
    Unsupported(String),
    #[error("LSP server for '{0}' is not installed")]
    NotInstalled(String),
    #[error("daemon is shutting down")]
    ShuttingDown,
    #[error("failed to spawn LSP server: {0}")]
    Spawn(#[from] std::io::Error),
}

pub(crate) type ResolveFuture<'a> =
    Pin<Box<dyn Future<Output = Option<ResolvedCommand>> + Send + 'a>>;

/// Resolves a language to a spawnable command: [`LspRegistry`] in production,
/// a fake in tests.
pub(crate) trait CommandResolver: Send + Sync {
    fn resolve<'a>(&'a self, language: &'a str, project: &'a Path) -> ResolveFuture<'a>;
}

impl CommandResolver for LspRegistry {
    fn resolve<'a>(&'a self, language: &'a str, project: &'a Path) -> ResolveFuture<'a> {
        Box::pin(self.resolve_command(language, Some(project)))
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Timeouts {
    pub(crate) idle: Duration,
    pub(crate) shutdown_request: Duration,
    pub(crate) shutdown_exit: Duration,
    pub(crate) sigterm_grace: Duration,
}

impl Default for Timeouts {
    fn default() -> Self {
        Self {
            idle: Duration::from_secs(10 * 60),
            shutdown_request: Duration::from_secs(3),
            shutdown_exit: Duration::from_secs(2),
            sigterm_grace: Duration::from_secs(2),
        }
    }
}

impl Timeouts {
    /// The longest one shutdown can take before it gives up on the child.
    fn shutdown_budget(&self) -> Duration {
        self.shutdown_request + self.shutdown_exit + self.sigterm_grace * 2
    }
}

fn key(project_id: &str, language: &str) -> String {
    format!("{project_id}:{language}")
}

pub(crate) struct ManagerState {
    handles: DashMap<String, Arc<LspServerHandle>>,
    registry: Arc<LspRegistry>,
    resolver: Arc<dyn CommandResolver>,
    flights: mainframe_runtime::sync::SingleFlight,
    /// Orders spawns against `shutdown_all`'s snapshot, so no child starts
    /// after it.
    spawn_gate: Mutex<()>,
    shutting_down: watch::Sender<bool>,
    timeouts: Timeouts,
}

pub struct LspManager {
    state: Arc<ManagerState>,
}

impl LspManager {
    pub fn new(registry: LspRegistry) -> Self {
        let registry = Arc::new(registry);
        Self::with_resolver(registry.clone(), registry, Timeouts::default())
    }

    pub(crate) fn with_resolver(
        registry: Arc<LspRegistry>,
        resolver: Arc<dyn CommandResolver>,
        timeouts: Timeouts,
    ) -> Self {
        Self {
            state: Arc::new(ManagerState {
                handles: DashMap::new(),
                registry,
                resolver,
                flights: mainframe_runtime::sync::SingleFlight::default(),
                spawn_gate: Mutex::new(()),
                shutting_down: watch::channel(false).0,
                timeouts,
            }),
        }
    }

    pub fn registry(&self) -> &LspRegistry {
        &self.state.registry
    }

    /// Validates a connection and returns the running server for it,
    /// spawning one when none runs. The caller completes the WebSocket upgrade
    /// and then [`attach`](Self::attach)es the socket.
    pub async fn connect(
        &self,
        project_id: &str,
        language: &str,
        project_path: &str,
    ) -> Result<Arc<LspServerHandle>, LspError> {
        if let Err(source) = tokio::fs::metadata(project_path).await {
            return Err(LspError::PathNotFound {
                path: project_path.to_owned(),
                source,
            });
        }
        if !self.state.registry.supports(language) {
            return Err(LspError::Unsupported(language.to_owned()));
        }
        self.state
            .get_or_spawn(project_id, language, project_path)
            .await
    }

    /// Makes `handle`'s editor session this socket's, closing any previous
    /// one. Must be called inside the Tokio runtime: dropping the client
    /// re-arms the idle reaper.
    pub fn attach(&self, handle: &Arc<LspServerHandle>) -> LspClient {
        LspClient::attach(Arc::clone(&self.state), Arc::clone(handle))
    }

    pub fn active_languages(&self, project_id: &str) -> Vec<String> {
        self.state
            .handles
            .iter()
            .filter(|entry| entry.value().project_id == project_id)
            .map(|entry| entry.value().language.clone())
            .collect()
    }

    /// Stops every server concurrently and refuses later spawns.
    pub async fn shutdown_all(&self) {
        self.state.shutdown_all().await;
    }
}

#[cfg(test)]
impl LspManager {
    async fn get_or_spawn(
        &self,
        project_id: &str,
        language: &str,
    ) -> Result<Arc<LspServerHandle>, LspError> {
        self.state.get_or_spawn(project_id, language, "/tmp").await
    }

    async fn shutdown(&self, project_id: &str, language: &str) {
        let handle = self.get_handle(project_id, language);
        if let Some(handle) = handle {
            self.state.shutdown_handle(&handle).await;
        }
    }

    fn get_handle(&self, project_id: &str, language: &str) -> Option<Arc<LspServerHandle>> {
        let handle = self.state.handles.get(&key(project_id, language));
        handle.map(|entry| entry.value().clone())
    }
}

#[cfg(test)]
#[path = "manager_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "manager_tests_signals.rs"]
mod signal_tests;

#[cfg(test)]
mod shutdown_tests;
