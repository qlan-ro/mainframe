//! Per-`(projectId, language)` LSP child lifecycle: single-flight spawn, the
//! idle-timeout reaper, and the graceful shutdown handshake (shutdown request ->
//! exit notification -> SIGTERM/SIGKILL fallback).

use mainframe_types::sync::LockExt as _;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use dashmap::DashMap;
use tokio::io::AsyncReadExt;
use tokio::process::{Child, ChildStderr, ChildStdout, Command};
use tokio::sync::{Notify, mpsc, watch};
use tokio::task::JoinHandle;

use crate::lsp_proxy::{BridgeHandle, encode_json_rpc};
use crate::lsp_registry::{LspRegistry, ResolvedCommand};
use mainframe_runtime::process::Signal;

const IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60); // 10 minutes
const SHUTDOWN_REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
const SHUTDOWN_EXIT_TIMEOUT: Duration = Duration::from_secs(2);
const SIGTERM_GRACE: Duration = Duration::from_secs(2);

/// Delivers a signal to an owned pid and reports whether it was delivered.
/// A seam so tests can record the escalation.
pub(crate) type SignalFn =
    Arc<dyn Fn(u32, Signal) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync>;

/// Errors from spawning an LSP child.
#[derive(Debug, thiserror::Error)]
pub enum LspError {
    #[error("LSP server for '{0}' is not installed")]
    NotInstalled(String),
    #[error("Daemon is shutting down")]
    ShuttingDown,
    #[error("failed to spawn LSP server: {0}")]
    Spawn(#[from] std::io::Error),
}

/// Resolves a language id to a spawnable command. Implemented by [`LspRegistry`];
/// the trait exists so tests can inject a fake resolver.
pub trait CommandResolver: Send + Sync {
    fn resolve_command<'a>(
        &'a self,
        language: &'a str,
        project_path: &'a str,
    ) -> Pin<Box<dyn Future<Output = Option<ResolvedCommand>> + Send + 'a>>;
}

impl CommandResolver for LspRegistry {
    fn resolve_command<'a>(
        &'a self,
        language: &'a str,
        project_path: &'a str,
    ) -> Pin<Box<dyn Future<Output = Option<ResolvedCommand>> + Send + 'a>> {
        Box::pin(async move { LspRegistry::resolve_command(self, language, project_path).await })
    }
}

fn key(project_id: &str, language: &str) -> String {
    format!("{project_id}:{language}")
}

struct ManagerState {
    handles: DashMap<String, Arc<LspServerHandle>>,
    resolver: Arc<dyn CommandResolver>,
    registry: Arc<LspRegistry>,
    guards: mainframe_runtime::sync::SingleFlight,
    spawn_gate: Mutex<()>,
    shutting_down: watch::Sender<bool>,
    idle_timeout: Duration,
    shutdown_request_timeout: Duration,
    shutdown_exit_timeout: Duration,
    sigterm_grace: Duration,
    signal: SignalFn,
}

/// Split a `"projectId:language"` key. The language never contains a `:`, so the
/// LAST `:` separates the (uuid) projectId from the language.
fn split_key(k: &str) -> (String, String) {
    match k.rsplit_once(':') {
        Some((project_id, language)) => (project_id.to_string(), language.to_string()),
        None => (k.to_string(), String::new()),
    }
}

/// Manages the lifecycle of LSP server processes, one per `(projectId, language)`.
pub struct LspManager {
    state: Arc<ManagerState>,
}

impl LspManager {
    pub fn new(registry: Arc<LspRegistry>) -> Self {
        let resolver: Arc<dyn CommandResolver> = registry.clone();
        Self::with_resolver(registry, resolver)
    }

    /// Construct with a distinct command resolver (test seam for the TS
    /// `vi.spyOn(registry, 'resolveCommand')`).
    pub(crate) fn with_resolver(
        registry: Arc<LspRegistry>,
        resolver: Arc<dyn CommandResolver>,
    ) -> Self {
        Self {
            state: Arc::new(ManagerState {
                handles: DashMap::new(),
                resolver,
                registry,
                guards: mainframe_runtime::sync::SingleFlight::default(),
                spawn_gate: Mutex::new(()),
                shutting_down: watch::channel(false).0,
                idle_timeout: IDLE_TIMEOUT,
                shutdown_request_timeout: SHUTDOWN_REQUEST_TIMEOUT,
                shutdown_exit_timeout: SHUTDOWN_EXIT_TIMEOUT,
                sigterm_grace: SIGTERM_GRACE,
                signal: kill_signal(),
            }),
        }
    }

    /// The backing registry.
    pub fn registry(&self) -> &Arc<LspRegistry> {
        &self.state.registry
    }

    pub(crate) async fn get_or_spawn(
        &self,
        project_id: &str,
        language: &str,
        project_path: &str,
    ) -> Result<Arc<LspServerHandle>, LspError> {
        self.state
            .get_or_spawn(project_id, language, project_path)
            .await
    }

    pub fn start_idle_timer(&self, k: &str, handle: &Arc<LspServerHandle>) {
        self.state.start_idle_timer(k, handle);
    }

    pub fn cancel_idle_timer(&self, handle: &Arc<LspServerHandle>) {
        self.state.cancel_idle_timer(handle);
    }

    pub async fn shutdown(&self, project_id: &str, language: &str) {
        self.state.shutdown(project_id, language).await;
    }

    pub async fn shutdown_all(&self) {
        self.state.shutdown_all().await;
    }

    pub fn get_active_languages(&self, project_id: &str) -> Vec<String> {
        let prefix = format!("{project_id}:");
        self.state
            .handles
            .iter()
            .filter(|e| e.key().starts_with(&prefix))
            .map(|e| e.value().language.clone())
            .collect()
    }

    pub(crate) fn get_handle(
        &self,
        project_id: &str,
        language: &str,
    ) -> Option<Arc<LspServerHandle>> {
        self.state
            .handles
            .get(&key(project_id, language))
            .map(|h| h.clone())
    }
}

#[cfg(test)]
impl LspManager {
    /// Shrink the idle/shutdown timers so lifecycle tests run in real time
    /// without `tokio::time::pause` fighting real child I/O.
    pub(crate) fn set_test_timeouts(
        &mut self,
        idle: Duration,
        request: Duration,
        exit: Duration,
        sigterm_grace: Duration,
    ) {
        let state = Arc::get_mut(&mut self.state).expect("no outstanding clones in test setup");
        state.idle_timeout = idle;
        state.shutdown_request_timeout = request;
        state.shutdown_exit_timeout = exit;
        state.sigterm_grace = sigterm_grace;
    }

    /// Replace the signal sender, e.g. with one that records each delivery.
    pub(crate) fn set_test_signal(&mut self, signal: SignalFn) {
        let state = Arc::get_mut(&mut self.state).expect("no outstanding clones in test setup");
        state.signal = signal;
    }
}

#[cfg(test)]
mod tests;

mod handle;
mod lifecycle;
mod process;
mod spawn;
pub use handle::{ClientRef, LspServerHandle};
use process::{kill_signal, wait_for_handle_exit};

#[cfg(test)]
mod shutdown_tests;
