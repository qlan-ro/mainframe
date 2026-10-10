use super::*;
use mainframe_runtime::process::{TailBuffer, finish_pumps, spawn_line_pump, spawn_stdin_writer};
use tokio::task::JoinHandle;

struct ProcessWatch {
    pending: Arc<Mutex<HashMap<RequestId, PendingTx>>>,
    closed: Arc<AtomicBool>,
    exited: Arc<AtomicBool>,
    close_notify: Arc<Notify>,
    kill_notify: Arc<Notify>,
    tail: Mutex<TailBuffer>,
    saw_panic: AtomicBool,
    handlers: JsonRpcHandlers,
}

impl JsonRpcClient {
    pub fn new(child: Child, handlers: JsonRpcHandlers) -> Self {
        Self::with_timeout(child, handlers, DEFAULT_REQUEST_TIMEOUT_MS)
    }

    pub(crate) fn with_timeout(
        mut child: Child,
        handlers: JsonRpcHandlers,
        request_timeout_ms: u64,
    ) -> Self {
        let client = Self {
            next_id: AtomicI64::new(1),
            pending: Arc::new(Mutex::new(HashMap::new())),
            closed: Arc::new(AtomicBool::new(false)),
            exited: Arc::new(AtomicBool::new(false)),
            close_notify: Arc::new(Notify::new()),
            kill_notify: Arc::new(Notify::new()),
            write_tx: spawn_stdin_writer(child.stdin.take()),
            request_timeout_ms,
        };
        let watch = Arc::new(ProcessWatch {
            pending: client.pending.clone(),
            closed: client.closed.clone(),
            exited: client.exited.clone(),
            close_notify: client.close_notify.clone(),
            kill_notify: client.kill_notify.clone(),
            tail: Mutex::new(TailBuffer::new(STDERR_TAIL_LINES)),
            saw_panic: AtomicBool::new(false),
            handlers,
        });
        let pumps = watch.pumps(&mut child);
        tokio::spawn(watch.run(child, pumps));
        client
    }
}

impl ProcessWatch {
    fn pumps(self: &Arc<Self>, child: &mut Child) -> Vec<JoinHandle<()>> {
        let stdout = child.stdout.take().map(|stdout| {
            let watch = self.clone();
            spawn_line_pump(stdout, move |line| watch.stdout(line))
        });
        let stderr = child.stderr.take().map(|stderr| {
            let watch = self.clone();
            spawn_line_pump(stderr, move |line| watch.stderr(line))
        });
        [stdout, stderr].into_iter().flatten().collect()
    }

    fn stdout(&self, line: String) {
        if line.trim().is_empty() {
            return;
        }
        tracing::trace!(module = "codex:jsonrpc", line, "jsonrpc recv");
        match parse_jsonrpc_messages(&line) {
            Ok(messages) => {
                for message in messages {
                    dispatch(&message, &self.pending, &self.handlers);
                }
            }
            Err(_) => {
                let head: String = line.chars().take(200).collect();
                tracing::warn!(
                    module = "codex:jsonrpc",
                    line = head,
                    "jsonrpc: malformed JSON line"
                );
            }
        }
    }

    fn stderr(&self, line: String) {
        let message = line.trim();
        if message.is_empty() {
            return;
        }
        if is_panic_line(message) {
            self.saw_panic.store(true, Ordering::SeqCst);
        }
        self.tail.lock_recover().push(message.to_string());
        if is_tracing_line(message) {
            tracing::debug!(module = "codex:jsonrpc", stderr = message, "codex stderr");
        } else {
            tracing::warn!(module = "codex:jsonrpc", stderr = message, "codex stderr");
        }
    }

    async fn run(self: Arc<Self>, mut child: Child, pumps: Vec<JoinHandle<()>>) {
        let code = tokio::select! {
            status = child.wait() => status.ok().and_then(|status| status.code()),
            _ = self.kill_notify.notified() => shutdown(&mut child).await,
        };
        self.exited.store(true, Ordering::SeqCst);
        reject_all_pending(
            &self.pending,
            JsonRpcError(format!("Process exited with code {code:?}")),
        );
        finish_pumps(pumps).await;
        self.report_exit(code);
        self.close_notify.notify_waiters();
        (self.handlers.on_exit)(code);
    }

    fn report_exit(&self, code: Option<i32>) {
        let panicked = self.saw_panic.load(Ordering::SeqCst);
        if self.closed.load(Ordering::SeqCst) || (code == Some(0) && !panicked) {
            return;
        }
        let reason = match (code, panicked) {
            (Some(code), _) => format!("exited with code {code}"),
            (None, true) => "panicked".to_string(),
            (None, false) => "was killed by a signal".to_string(),
        };
        let tail: Vec<String> = self.tail.lock_recover().iter().cloned().collect();
        (self.handlers.on_error)(if tail.is_empty() {
            format!("codex {reason}")
        } else {
            format!("codex {reason}:\n{}", tail.join("\n"))
        });
    }
}

async fn shutdown(child: &mut Child) -> Option<i32> {
    use mainframe_runtime::process::{Target, terminate};
    if let Some(pid) = child.id() {
        let result = terminate(Target::Pid(pid), Duration::from_millis(800), async {
            if let Err(error) = child.wait().await {
                tracing::warn!(%error, "codex wait failed");
            }
        })
        .await;
        if let Err(error) = result {
            tracing::warn!(%error, "codex shutdown failed");
        }
    }
    child.wait().await.ok().and_then(|status| status.code())
}
