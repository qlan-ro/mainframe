use super::*;

/// A live WS client attached to a handle. The concrete axum socket lives in
/// `mainframe-server::websocket`; this is the seam the server drives.
pub struct ClientRef {
    pub(super) open: Arc<AtomicBool>,
    pub(super) close_tx: mpsc::UnboundedSender<(u16, String)>,
}

impl ClientRef {
    pub fn new(open: Arc<AtomicBool>, close_tx: mpsc::UnboundedSender<(u16, String)>) -> Self {
        Self { open, close_tx }
    }

    /// Parity with `client.readyState === WebSocket.OPEN`.
    pub(crate) fn is_open(&self) -> bool {
        self.open.load(Ordering::SeqCst)
    }

    /// Close the client socket with `code` and `reason`.
    pub fn close(&self, code: u16, reason: &str) {
        self.open.store(false, Ordering::SeqCst);
        let _ = self.close_tx.send((code, reason.to_string()));
    }
}

/// Per-handle mutable fields (per entity; one connection task owns them).
#[derive(Default)]
pub(super) struct HandleInner {
    pub(super) client: Option<ClientRef>,
    pub(super) idle_timer: Option<JoinHandle<()>>,
    pub(super) cleanup: Option<BridgeHandle>,
    pub(super) initialize_result: Option<serde_json::Value>,
}

/// One spawned LSP server. Stored as `Arc` in the manager's handle map.
pub struct LspServerHandle {
    pub language: String,
    pub project_path: String,
    pub(super) pid: u32,
    /// Signals for the monitor task, the child's only reaper (see `deliver`).
    pub(super) signal_tx: mpsc::UnboundedSender<&'static str>,
    pub(super) stdin_tx: mpsc::UnboundedSender<Vec<u8>>,
    pub(super) stdout: Mutex<Option<ChildStdout>>,
    pub(super) stderr: Mutex<Option<ChildStderr>>,
    pub(super) exited: Arc<AtomicBool>,
    pub(super) exit_notify: Arc<Notify>,
    pub(super) inner: Mutex<HandleInner>,
}

impl LspServerHandle {
    pub(super) fn lock_inner(&self) -> std::sync::MutexGuard<'_, HandleInner> {
        self.inner.lock_recover()
    }

    /// Whether a client is currently attached (parity with `handle.client` truthiness).
    pub(crate) fn has_client(&self) -> bool {
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
    pub(crate) fn set_initialize_result(&self, result: serde_json::Value) {
        self.lock_inner().initialize_result = Some(result);
    }

    pub fn initialize_result(&self) -> Option<serde_json::Value> {
        self.lock_inner().initialize_result.clone()
    }

    pub(super) fn signal(&self, flag: &'static str) {
        let _ = self.signal_tx.send(flag); /* expected: Err means the monitor already reaped the child */
    }

    /// Framed writer for this child's stdin (shared by the bridge and shutdown).
    pub fn stdin_tx(&self) -> mpsc::UnboundedSender<Vec<u8>> {
        self.stdin_tx.clone()
    }

    /// Take the child's stdout pipe (the bridge or shutdown consumes it once).
    pub fn take_stdout(&self) -> Option<ChildStdout> {
        self.stdout.lock_recover().take()
    }

    /// Take the child's stderr pipe (the bridge consumes it once).
    pub fn take_stderr(&self) -> Option<ChildStderr> {
        self.stderr.lock_recover().take()
    }

    #[cfg(test)]
    pub(crate) fn has_idle_timer(&self) -> bool {
        self.lock_inner().idle_timer.is_some()
    }
}

impl LspServerHandle {
    pub(super) fn from_child(
        child: &mut Child,
        language: &str,
        project_path: &str,
        signal_tx: mpsc::UnboundedSender<&'static str>,
    ) -> Self {
        Self {
            language: language.to_string(),
            project_path: project_path.to_string(),
            pid: child.id().unwrap_or(0),
            signal_tx,
            stdin_tx: spawn_stdin_writer(child.stdin.take()),
            stdout: Mutex::new(child.stdout.take()),
            stderr: Mutex::new(child.stderr.take()),
            exited: Arc::new(AtomicBool::new(false)),
            exit_notify: Arc::new(Notify::new()),
            inner: Mutex::new(HandleInner::default()),
        }
    }
}

fn spawn_stdin_writer(stdin: Option<tokio::process::ChildStdin>) -> mpsc::UnboundedSender<Vec<u8>> {
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    if let Some(mut stdin) = stdin {
        tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            while let Some(bytes) = rx.recv().await {
                if stdin.write_all(&bytes).await.is_err() || stdin.flush().await.is_err() {
                    break;
                }
            }
        });
    }
    tx
}
