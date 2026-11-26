use super::write_guard::guarded_writer;
use super::*;
use mainframe_runtime::process::{TailBuffer, finish_pumps, spawn_line_pump};
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
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let write_guards = WriteGuards::default();
        let write_tx = guarded_writer(child.stdin.take(), pending.clone(), write_guards.clone());
        let client = Self {
            next_id: AtomicI64::new(1),
            pending,
            closed: Arc::new(AtomicBool::new(false)),
            exited: Arc::new(AtomicBool::new(false)),
            close_notify: Arc::new(Notify::new()),
            kill_notify: Arc::new(Notify::new()),
            write_tx,
            write_guards: Some(write_guards),
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
        reject_all_pending(
            &self.pending,
            JsonRpcError(format!("Process exited with code {code:?}")),
        );
        finish_pumps(pumps).await;
        self.report_exit(code);
        self.closed.store(true, Ordering::SeqCst);
        (self.handlers.on_exit)(code);
        self.exited.store(true, Ordering::SeqCst);
        self.close_notify.notify_waiters();
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
    wait_for_group(
        child,
        close,
        mainframe_runtime::process::child_exited_unreaped,
        sweep_group,
    )
    .await
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
async fn wait_for_group(
    child: &mut Child,
    close: &Notify,
    probe: impl Fn(u32) -> std::io::Result<bool>,
    sweep: impl FnOnce(mainframe_runtime::process::Target),
) -> Option<i32> {
    use mainframe_runtime::process::Target;
    let pid = child.id()?;
    let target = Target::Group(pid);
    let exit = observe_child_exit(pid, &probe);
    tokio::pin!(exit);
    let (closing, owned) = tokio::select! {
        biased;
        () = close.notified() => (true, close_group(pid, &probe, exit.as_mut()).await),
        result = exit.as_mut() => (false, result),
    };
    // waitid with WNOWAIT leaves the leader in place until after the sweep.
    match owned {
        Ok(()) => sweep(target),
        Err(error) => {
            tracing::warn!(%error, "could not observe unreaped codex leader; using child shutdown");
            if closing {
                close.notify_one();
            }
        }
    }
    wait_for_owned_child(child, close).await
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
async fn close_group(
    pid: u32,
    probe: &impl Fn(u32) -> std::io::Result<bool>,
    exit: impl std::future::Future<Output = std::io::Result<()>>,
) -> std::io::Result<()> {
    use mainframe_runtime::process::{Signal, Target, signal};
    if probe(pid)? {
        return Ok(());
    }
    if let Err(error) = signal(Target::Group(pid), Signal::Term) {
        tracing::warn!(%error, "codex group TERM failed");
    }
    match tokio::time::timeout(Duration::from_millis(800), exit).await {
        Ok(result) => result,
        Err(_) => probe(pid).map(|_| ()),
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn sweep_group(target: mainframe_runtime::process::Target) {
    use mainframe_runtime::process::{Signal, signal};
    if let Err(error) = signal(target, Signal::Kill) {
        tracing::warn!(%error, "codex process group cleanup failed");
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
async fn observe_child_exit(
    pid: u32,
    probe: &impl Fn(u32) -> std::io::Result<bool>,
) -> std::io::Result<()> {
    use tokio::signal::unix::{SignalKind, signal};
    let mut changed = signal(SignalKind::child()).ok();
    while !probe(pid)? {
        tokio::select! {
            () = tokio::time::sleep(Duration::from_secs(2)) => {},
            Some(()) = async { changed.as_mut()?.recv().await } => {},
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
async fn wait_for_process(child: &mut Child, close: &Notify) -> Option<i32> {
    wait_for_owned_child(child, close).await
}

async fn wait_for_owned_child(child: &mut Child, close: &Notify) -> Option<i32> {
    loop {
        let status = tokio::select! {
            biased;
            () = close.notified() => stop_owned_child(child).await,
            status = child.wait() => status,
        };
        match status {
            Ok(status) => return status.code(),
            Err(error) => {
                tracing::warn!(%error, "codex exit could not be confirmed");
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
}

async fn stop_owned_child(child: &mut Child) -> std::io::Result<std::process::ExitStatus> {
    if let Some(status) = child.try_wait()? {
        return Ok(status);
    }
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        use mainframe_runtime::process::{Signal, Target, signal};
        // A successful try_wait pins this PID until this watcher reaps it.
        match signal(Target::Pid(pid), Signal::Term) {
            Ok(true) => {
                if let Ok(Ok(status)) =
                    tokio::time::timeout(Duration::from_millis(800), child.wait()).await
                {
                    return Ok(status);
                }
            }
            Ok(false) => {}
            Err(error) => tracing::warn!(%error, "codex child TERM failed"),
        }
    }
    if let Some(status) = child.try_wait()? {
        return Ok(status);
    }
    child.start_kill()?;
    child.wait().await
}

#[cfg(test)]
#[cfg(any(target_os = "macos", target_os = "linux"))]
#[path = "process_tests.rs"]
mod tests;
