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
        tracing::trace!(line, "jsonrpc recv");
        match parse_jsonrpc_messages(&line) {
            Ok(messages) => {
                for message in messages {
                    dispatch(&message, &self.pending, &self.handlers);
                }
            }
            Err(_) => {
                let head: String = line.chars().take(200).collect();
                tracing::warn!(line = head, "malformed JSON line");
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
            tracing::debug!(stderr = message, "codex stderr");
        } else {
            tracing::warn!(stderr = message, "codex stderr");
        }
    }

    async fn run(self: Arc<Self>, mut child: Child, pumps: Vec<JoinHandle<()>>) {
        let code = wait_for_process(&mut child, &self.kill_notify).await;
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

#[cfg(any(target_os = "macos", target_os = "linux"))]
async fn wait_for_process(child: &mut Child, close: &Notify) -> Option<i32> {
    wait_for_group(child, close, sweep_group).await
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
async fn wait_for_group(
    child: &mut Child,
    close: &Notify,
    sweep: impl FnOnce(mainframe_runtime::process::Target),
) -> Option<i32> {
    use mainframe_runtime::process::{Signal, Target, child_exited_unreaped, signal};
    let pid = child.id()?;
    let target = Target::Group(pid);
    let exit = observe_child_exit(pid);
    tokio::pin!(exit);
    let owned = tokio::select! {
        result = &mut exit => result,
        () = close.notified() => match child_exited_unreaped(pid) {
            Ok(false) => {
                if let Err(error) = signal(target, Signal::Term) {
                    tracing::warn!(%error, "codex group TERM failed");
                }
                match tokio::time::timeout(Duration::from_millis(800), &mut exit).await {
                    Ok(result) => result,
                    Err(_) => child_exited_unreaped(pid).map(|_| ()),
                }
            }
            Ok(true) => Ok(()),
            Err(error) => Err(error),
        }
    };
    // waitid with WNOWAIT leaves the leader in place until after the sweep.
    match owned {
        Ok(()) => sweep(target),
        Err(error) => tracing::warn!(%error, "could not observe unreaped codex leader"),
    }
    child.wait().await.ok().and_then(|status| status.code())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn sweep_group(target: mainframe_runtime::process::Target) {
    use mainframe_runtime::process::{Signal, signal};
    if let Err(error) = signal(target, Signal::Kill) {
        tracing::warn!(%error, "codex process group cleanup failed");
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
async fn observe_child_exit(pid: u32) -> std::io::Result<()> {
    use mainframe_runtime::process::child_exited_unreaped;
    use tokio::signal::unix::{SignalKind, signal};
    let mut changed = signal(SignalKind::child()).ok();
    while !child_exited_unreaped(pid)? {
        tokio::select! {
            () = tokio::time::sleep(Duration::from_secs(2)) => {},
            Some(()) = async { changed.as_mut()?.recv().await } => {},
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
async fn wait_for_process(child: &mut Child, close: &Notify) -> Option<i32> {
    use mainframe_runtime::process::{Target, terminate};
    let pid = child.id()?;
    tokio::select! {
        status = child.wait() => return status.ok().and_then(|status| status.code()),
        () = close.notified() => {}
    }
    if let Err(error) = terminate(Target::Pid(pid), Duration::from_millis(800), async {
        if let Err(error) = child.wait().await {
            tracing::warn!(%error, "codex wait failed");
        }
    })
    .await
    {
        tracing::warn!(%error, "codex shutdown failed");
    }
    child.wait().await.ok().and_then(|status| status.code())
}

#[cfg(test)]
#[cfg(any(target_os = "macos", target_os = "linux"))]
#[path = "process_tests.rs"]
mod tests;
