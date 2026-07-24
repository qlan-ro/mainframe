//! Ported from `packages/core/src/lsp/lsp-manager.ts`.
//!
//! Per-`(projectId, language)` LSP child lifecycle: single-flight spawn, the
//! idle-timeout reaper, and the graceful shutdown handshake (shutdown request ->
//! exit notification -> SIGTERM fallback).

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use dashmap::DashMap;
use tokio::io::AsyncReadExt;
use tokio::process::{ChildStderr, ChildStdout, Command};
use tokio::sync::{Notify, mpsc};
use tokio::task::JoinHandle;

use crate::lsp_proxy::{BridgeHandle, encode_json_rpc};
use crate::lsp_registry::{LspRegistry, ResolvedCommand};

const IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60); // 10 minutes
const SHUTDOWN_REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
const SHUTDOWN_EXIT_TIMEOUT: Duration = Duration::from_secs(2);

/// Errors from spawning an LSP child.
#[derive(Debug, thiserror::Error)]
pub enum LspError {
    #[error("LSP server for '{0}' is not installed")]
    NotInstalled(String),
    #[error("failed to spawn LSP server: {0}")]
    Spawn(#[from] std::io::Error),
}

/// Resolves a language id to a spawnable command. Implemented by [`LspRegistry`];
/// the trait exists so tests can inject a fake resolver (the parity of the TS
/// `vi.spyOn(registry, 'resolveCommand')`).
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

/// A live WS client attached to a handle. The concrete axum socket lives in the
/// deferred server layer; this is the seam the server drives.
pub struct ClientRef {
    open: Arc<AtomicBool>,
    close_tx: mpsc::UnboundedSender<(u16, String)>,
}

impl ClientRef {
    pub fn new(open: Arc<AtomicBool>, close_tx: mpsc::UnboundedSender<(u16, String)>) -> Self {
        Self { open, close_tx }
    }

    /// Parity with `client.readyState === WebSocket.OPEN`.
    pub fn is_open(&self) -> bool {
        self.open.load(Ordering::SeqCst)
    }

    /// Parity with `client.close(code, reason)`.
    pub fn close(&self, code: u16, reason: &str) {
        self.open.store(false, Ordering::SeqCst);
        let _ = self.close_tx.send((code, reason.to_string()));
    }
}

/// Per-handle mutable fields (CONCURRENCY.tsv: PER_ENTITY, one connection task owns them).
#[derive(Default)]
struct HandleInner {
    client: Option<ClientRef>,
    idle_timer: Option<JoinHandle<()>>,
    cleanup: Option<BridgeHandle>,
    initialize_result: Option<serde_json::Value>,
}

/// One spawned LSP server. Stored as `Arc` in the manager's handle map.
pub struct LspServerHandle {
    pub language: String,
    pub project_path: String,
    pid: u32,
    stdin_tx: mpsc::UnboundedSender<Vec<u8>>,
    stdout: Mutex<Option<ChildStdout>>,
    stderr: Mutex<Option<ChildStderr>>,
    exited: Arc<AtomicBool>,
    exit_notify: Arc<Notify>,
    inner: Mutex<HandleInner>,
}

impl LspServerHandle {
    fn lock_inner(&self) -> std::sync::MutexGuard<'_, HandleInner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Whether a client is currently attached (parity with `handle.client` truthiness).
    pub fn has_client(&self) -> bool {
        self.lock_inner().client.is_some()
    }

    /// Whether a cached `initialize` result is present (reconnecting-client fast path).
    pub fn has_initialize_result(&self) -> bool {
        self.lock_inner().initialize_result.is_some()
    }

    /// Attach a client, returning the previously attached one (if any).
    pub fn set_client(&self, client: Option<ClientRef>) -> Option<ClientRef> {
        std::mem::replace(&mut self.lock_inner().client, client)
    }

    /// Store the deframing bridge so it is aborted on disconnect/shutdown.
    pub fn set_cleanup(&self, cleanup: Option<BridgeHandle>) {
        let prev = std::mem::replace(&mut self.lock_inner().cleanup, cleanup);
        if let Some(prev) = prev {
            prev.cleanup();
        }
    }

    /// Cache the `initialize` result so reconnecting clients skip re-initialization.
    pub fn set_initialize_result(&self, result: serde_json::Value) {
        self.lock_inner().initialize_result = Some(result);
    }

    pub fn initialize_result(&self) -> Option<serde_json::Value> {
        self.lock_inner().initialize_result.clone()
    }

    /// Framed writer for this child's stdin (shared by the bridge and shutdown).
    pub fn stdin_tx(&self) -> mpsc::UnboundedSender<Vec<u8>> {
        self.stdin_tx.clone()
    }

    /// Take the child's stdout pipe (the bridge or shutdown consumes it once).
    pub fn take_stdout(&self) -> Option<ChildStdout> {
        self.stdout.lock().unwrap_or_else(|e| e.into_inner()).take()
    }

    /// Take the child's stderr pipe (the bridge consumes it once).
    pub fn take_stderr(&self) -> Option<ChildStderr> {
        self.stderr.lock().unwrap_or_else(|e| e.into_inner()).take()
    }

    #[cfg(test)]
    pub(crate) fn has_idle_timer(&self) -> bool {
        self.lock_inner().idle_timer.is_some()
    }
}

fn key(project_id: &str, language: &str) -> String {
    format!("{project_id}:{language}")
}

/// Send SIGTERM to `pid`. Parity with `proc.kill('SIGTERM')`.
// NOTE: shells out to `kill -TERM` (unix) — tokio's `Child::kill` sends SIGKILL,
// which would diverge from the TS graceful SIGTERM. Windows has no `kill`;
// platform-sensitive, flagged for the Windows packaging pass.
async fn send_sigterm(pid: u32) {
    let _ = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .output()
        .await;
}

struct ManagerState {
    handles: DashMap<String, Arc<LspServerHandle>>,
    resolver: Arc<dyn CommandResolver>,
    registry: Arc<LspRegistry>,
    /// Single-flight spawn guards (CONCURRENCY.tsv rule 9 — `Notify` for `futures::Shared`).
    guards: Mutex<HashMap<String, Arc<Notify>>>,
    idle_timeout: Duration,
    shutdown_request_timeout: Duration,
    shutdown_exit_timeout: Duration,
}

impl ManagerState {
    fn lock_guards(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<Notify>>> {
        self.guards.lock().unwrap_or_else(|e| e.into_inner())
    }

    async fn get_or_spawn(
        self: &Arc<Self>,
        project_id: &str,
        language: &str,
        project_path: &str,
    ) -> Result<Arc<LspServerHandle>, LspError> {
        let k = key(project_id, language);

        loop {
            if let Some(existing) = self.handles.get(&k) {
                let existing = existing.clone();
                self.cancel_idle_timer(&existing);
                // Restart idle timer since no client may be connected.
                if !existing.has_client() {
                    self.start_idle_timer(&k, &existing);
                }
                return Ok(existing);
            }

            enum Claim {
                Await(Arc<Notify>),
                Mine(Arc<Notify>),
            }
            let claim = {
                let mut g = self.lock_guards();
                if let Some(n) = g.get(&k) {
                    Claim::Await(n.clone())
                } else {
                    let n = Arc::new(Notify::new());
                    g.insert(k.clone(), n.clone());
                    Claim::Mine(n)
                }
            };

            match claim {
                Claim::Await(existing) => {
                    // Join the in-flight spawn without a lost wakeup (enable before re-check).
                    let notified = existing.notified();
                    tokio::pin!(notified);
                    notified.as_mut().enable();
                    let still_in_flight = {
                        let g = self.lock_guards();
                        g.get(&k)
                            .is_some_and(|current| Arc::ptr_eq(current, &existing))
                    };
                    if still_in_flight {
                        notified.await;
                    }
                    // Winner inserted the handle (or spawn failed) — re-loop to read it.
                    continue;
                }
                Claim::Mine(notify) => {
                    let result = self.do_spawn(&k, language, project_path).await;
                    self.lock_guards().remove(&k);
                    notify.notify_waiters();
                    return result;
                }
            }
        }
    }

    async fn do_spawn(
        self: &Arc<Self>,
        k: &str,
        language: &str,
        project_path: &str,
    ) -> Result<Arc<LspServerHandle>, LspError> {
        let resolved = self
            .resolver
            .resolve_command(language, project_path)
            .await
            .ok_or_else(|| LspError::NotInstalled(language.to_string()))?;

        tracing::info!(language, project_path, command = %resolved.command, "Spawning LSP server");

        let mut command = Command::new(&resolved.command);
        command
            .args(&resolved.args)
            .current_dir(project_path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        if let Some(path) = self.registry.resolved_path() {
            command.env("PATH", path);
        }
        let mut child = command.spawn()?;

        let pid = child.id().unwrap_or(0);

        // Single stdin writer task fed by the framed `stdin_tx` (both the bridge
        // and graceful shutdown write through it, mirroring the shared `proc.stdin`).
        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        if let Some(mut stdin) = child.stdin.take() {
            tokio::spawn(async move {
                use tokio::io::AsyncWriteExt;
                while let Some(bytes) = stdin_rx.recv().await {
                    if stdin.write_all(&bytes).await.is_err() {
                        break;
                    }
                    let _ = stdin.flush().await;
                }
            });
        }

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let exited = Arc::new(AtomicBool::new(false));
        let exit_notify = Arc::new(Notify::new());

        let handle = Arc::new(LspServerHandle {
            language: language.to_string(),
            project_path: project_path.to_string(),
            pid,
            stdin_tx,
            stdout: Mutex::new(stdout),
            stderr: Mutex::new(stderr),
            exited: exited.clone(),
            exit_notify: exit_notify.clone(),
            inner: Mutex::new(HandleInner::default()),
        });

        // Monitor: owns the child, awaits exit, then removes the handle. Parity
        // with `child.on('exit')` + `child.on('error')` -> removeHandle.
        let state = Arc::clone(self);
        let key_owned = k.to_string();
        let language_owned = language.to_string();
        let project_path_owned = project_path.to_string();
        let handle_for_monitor = Arc::clone(&handle);
        tokio::spawn(async move {
            let status = child.wait().await;
            match status {
                Ok(s) => tracing::info!(
                    language = %language_owned,
                    project_path = %project_path_owned,
                    code = ?s.code(),
                    "LSP server exited"
                ),
                Err(err) => tracing::error!(
                    %err,
                    language = %language_owned,
                    project_path = %project_path_owned,
                    "LSP server process error"
                ),
            }
            exited.store(true, Ordering::SeqCst);
            exit_notify.notify_waiters();
            state.remove_handle(&key_owned, &handle_for_monitor);
        });

        self.handles.insert(k.to_string(), Arc::clone(&handle));
        self.start_idle_timer(k, &handle);

        Ok(handle)
    }

    /// Parity with `removeHandle`. Guards on identity so a dying old child never
    /// evicts a freshly respawned handle under the same key (the TS twin relied
    /// on JS single-threadedness for this).
    fn remove_handle(&self, k: &str, handle: &Arc<LspServerHandle>) {
        self.cancel_idle_timer(handle);
        handle.set_cleanup(None);
        {
            let inner = handle.lock_inner();
            if let Some(client) = &inner.client
                && client.is_open()
            {
                client.close(1001, "LSP server exited");
            }
        }
        handle.set_client(None);
        self.handles
            .remove_if(k, |_, current| Arc::ptr_eq(current, handle));
    }

    fn start_idle_timer(self: &Arc<Self>, k: &str, handle: &Arc<LspServerHandle>) {
        self.cancel_idle_timer(handle);
        let state = Arc::clone(self);
        let key_owned = k.to_string();
        let idle = self.idle_timeout;
        let task = tokio::spawn(async move {
            tokio::time::sleep(idle).await;
            tracing::info!(key = %key_owned, "LSP server idle timeout, shutting down");
            let (project_id, language) = split_key(&key_owned);
            state.shutdown(&project_id, &language).await;
        });
        handle.lock_inner().idle_timer = Some(task);
    }

    fn cancel_idle_timer(&self, handle: &Arc<LspServerHandle>) {
        if let Some(timer) = handle.lock_inner().idle_timer.take() {
            timer.abort();
        }
    }

    async fn shutdown(self: &Arc<Self>, project_id: &str, language: &str) {
        let k = key(project_id, language);
        let Some(handle) = self.handles.get(&k).map(|h| h.clone()) else {
            return;
        };

        self.cancel_idle_timer(&handle);
        handle.set_cleanup(None);

        if !handle.stdin_tx.is_closed() {
            // shutdown request -> await ack (or timeout) -> exit notification -> await exit (or timeout)
            let shutdown_req = serde_json::json!({
                "jsonrpc": "2.0", "id": "shutdown", "method": "shutdown", "params": null
            })
            .to_string();
            let _ = handle
                .stdin_tx
                .send(encode_json_rpc(&shutdown_req).into_bytes());

            if let Some(mut stdout) = handle.take_stdout() {
                let mut buf = [0u8; 8192];
                let _ = tokio::time::timeout(self.shutdown_request_timeout, stdout.read(&mut buf))
                    .await;
            } else {
                tokio::time::sleep(self.shutdown_request_timeout).await;
            }

            let exit_notif = serde_json::json!({ "jsonrpc": "2.0", "method": "exit" }).to_string();
            let _ = handle
                .stdin_tx
                .send(encode_json_rpc(&exit_notif).into_bytes());

            if !handle.exited.load(Ordering::SeqCst) {
                let notified = handle.exit_notify.notified();
                tokio::pin!(notified);
                notified.as_mut().enable();
                if !handle.exited.load(Ordering::SeqCst) {
                    let _ =
                        tokio::time::timeout(self.shutdown_exit_timeout, notified.as_mut()).await;
                }
            }
        }

        if !handle.exited.load(Ordering::SeqCst) {
            send_sigterm(handle.pid).await;
        }

        {
            let inner = handle.lock_inner();
            if let Some(client) = &inner.client
                && client.is_open()
            {
                client.close(1000, "LSP server shut down");
            }
        }
        handle.set_client(None);
        self.handles.remove(&k);
    }

    async fn shutdown_all(self: &Arc<Self>) {
        let keys: Vec<String> = self.handles.iter().map(|e| e.key().clone()).collect();
        for k in keys {
            let (project_id, language) = split_key(&k);
            self.shutdown(&project_id, &language).await;
        }
    }
}

/// Split a `"projectId:language"` key. The language never contains a `:`, so the
/// LAST `:` separates the (uuid) projectId from the language — parity with the
/// TS `key.split(':')` destructure where the array shape is `[projectId, language]`.
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
    pub fn with_resolver(registry: Arc<LspRegistry>, resolver: Arc<dyn CommandResolver>) -> Self {
        Self {
            state: Arc::new(ManagerState {
                handles: DashMap::new(),
                resolver,
                registry,
                guards: Mutex::new(HashMap::new()),
                idle_timeout: IDLE_TIMEOUT,
                shutdown_request_timeout: SHUTDOWN_REQUEST_TIMEOUT,
                shutdown_exit_timeout: SHUTDOWN_EXIT_TIMEOUT,
            }),
        }
    }

    /// The backing registry (parity with the TS `get registry()`).
    pub fn registry(&self) -> &Arc<LspRegistry> {
        &self.state.registry
    }

    pub async fn get_or_spawn(
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

    pub fn get_handle(&self, project_id: &str, language: &str) -> Option<Arc<LspServerHandle>> {
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
    pub(crate) fn set_test_timeouts(&mut self, idle: Duration, request: Duration, exit: Duration) {
        let state = Arc::get_mut(&mut self.state).expect("no outstanding clones in test setup");
        state.idle_timeout = idle;
        state.shutdown_request_timeout = request;
        state.shutdown_exit_timeout = exit;
    }
}

#[cfg(test)]
mod tests;

// PORT STATUS: packages/core/src/lsp/lsp-manager.ts (202 lines)
// confidence: high (single-flight, idle reaper, graceful-shutdown handshake)
// todos: 0
// notes: `spawning` Map<Promise> -> single-flight `Notify` (rule 9); `handles` ->
//   DashMap. child.on('exit'/'error') -> a monitor task awaiting `child.wait()`.
//   `proc.stdin` shared write -> a single stdin-writer task fed by `stdin_tx`.
//   `proc.kill('SIGTERM')` -> `kill -TERM <pid>` (tokio kills with SIGKILL; unix
//   only — flagged platform-sensitive). removeHandle guards on Arc identity to
//   avoid evicting a respawned handle (TS relied on JS single-threadedness).
