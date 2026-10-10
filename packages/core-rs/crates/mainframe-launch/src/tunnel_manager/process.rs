use super::*;

/// How a cloudflared child ended; `code` is `None` when a signal killed it.
#[derive(Debug, Clone, Copy)]
pub(super) struct TunnelExit {
    pub(super) code: Option<i32>,
}

/// A spawned cloudflared. Its `Child` belongs to the watcher task started by
/// `TunnelManager::watch_child`, the only code that reaps it. Signals go through
/// that task, which delivers them only while the child is unreaped, so the pid
/// can never name a recycled process.
#[derive(Clone)]
pub(super) struct TunnelProcess {
    pub(super) id: u64,
    pub(super) label: String,
    pub(super) pid: Option<u32>,
    pub(super) signals: mpsc::UnboundedSender<&'static str>,
    pub(super) exit: watch::Receiver<Option<TunnelExit>>,
    /// Set by the first `terminate`, so a concurrent one waits instead of
    /// signalling a second time.
    pub(super) stopping: Arc<AtomicBool>,
}

impl TunnelProcess {
    pub(super) fn signal(&self, flag: &'static str) {
        let _ = self.signals.send(flag); /* expected: Err means the watcher already reaped the child */
    }

    pub(super) async fn exited(&self) -> TunnelExit {
        let mut exit = self.exit.clone();
        match exit.wait_for(Option::is_some).await {
            Ok(state) => {
                let state = *state;
                state.unwrap_or(TunnelExit { code: None })
            }
            // The watcher was dropped with the runtime; `kill_on_drop` killed the child.
            Err(_) => TunnelExit { code: None },
        }
    }

    /// SIGTERM, then SIGKILL if the child outlives `grace`. Returns once the
    /// watcher reports the exit, or after a further `grace` if SIGKILL did not
    /// reap it either (its reap record then stays for the next boot sweep).
    pub(super) async fn terminate(&self, grace: Duration) {
        if self.exit.borrow().is_some() {
            return;
        }
        if self.stopping.swap(true, Ordering::SeqCst) {
            // Another caller is escalating; wait as long as its two grace periods.
            if timeout(grace.saturating_mul(2), self.exited())
                .await
                .is_err()
            {
                tracing::warn!(target: "tunnel", pid = ?self.pid, "tunnel still running after a concurrent stop");
            }
            return;
        }
        use mainframe_runtime::process::{Signal, Terminated, terminate_with};
        let result = terminate_with(
            |kind| {
                self.signal(if kind == Signal::Term {
                    "-TERM"
                } else {
                    "-KILL"
                });
                Ok(())
            },
            grace,
            async {
                self.exited().await;
            },
        )
        .await;
        if !matches!(result, Ok(Terminated::Exited | Terminated::Killed)) {
            tracing::warn!(target: "tunnel", pid = ?self.pid, "tunnel survived shutdown");
            self.stopping.store(false, Ordering::SeqCst);
        }
    }
}

/// Ends a `start` that did not hand its child to the post-ready exit watcher —
/// cancelled, failed, or timed out: SIGKILLs the child (the `kill_on_drop` the
/// watcher's ownership replaced) and drops the tunnel entry it had published.
pub(super) struct StartGuard<'a> {
    pub(super) tunnels: &'a DashMap<String, ManagedTunnel>,
    pub(super) label: &'a str,
    pub(super) process: &'a TunnelProcess,
    pub(super) armed: bool,
}

impl Drop for StartGuard<'_> {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let id = self.process.id;
        self.tunnels
            .remove_if(self.label, |_, tunnel| tunnel.process.id == id);
        self.process.signal("-KILL");
    }
}

/// Deliver `flag` to the watched child, but only while it is unreaped: until
/// `wait` collects it, its pid cannot be reused by another process.
pub(super) async fn deliver(
    child: &mut Child,
    pid: Option<u32>,
    flag: &'static str,
    signal: &SignalFn,
) {
    match (child.try_wait(), pid) {
        (Ok(None), Some(pid)) => {
            if !signal(pid, flag).await {
                tracing::warn!(target: "tunnel", pid, flag, "failed to signal tunnel process");
            }
        }
        // Already exited; the watcher's `wait` arm reports it.
        (Ok(_), _) => {}
        (Err(err), _) => {
            tracing::warn!(target: "tunnel", ?pid, flag, ?err, "failed to check tunnel process");
        }
    }
}

pub(crate) fn kill_signal() -> SignalFn {
    Arc::new(|pid, flag| Box::pin(send_kill(pid, flag)))
}

async fn send_kill(pid: u32, flag: &'static str) -> bool {
    use mainframe_runtime::process::{Signal, Target, signal};
    let kind = match flag {
        "-TERM" => Signal::Term,
        "-KILL" => Signal::Kill,
        _ => return false,
    };
    match signal(Target::Pid(pid), kind) {
        Ok(delivered) => delivered,
        Err(error) => {
            tracing::warn!(pid, flag, %error, "failed to signal child");
            false
        }
    }
}
