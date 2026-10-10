use super::*;

// Tokio only exposes SIGKILL; use kill(1) for the graceful SIGTERM step.
pub(super) fn kill_signal() -> SignalFn {
    Arc::new(|pid, flag| Box::pin(send_kill(pid, flag)))
}

async fn send_kill(pid: u32, flag: &'static str) -> bool {
    match Command::new("kill")
        .arg(flag)
        .arg(pid.to_string())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
    {
        Ok(status) => status.success(),
        Err(err) => {
            tracing::warn!(pid, flag, ?err, "failed to run kill");
            false
        }
    }
}

/// Deliver `flag` to the monitored child, but only while it is unreaped: until
/// `wait` collects it, its pid cannot be reused by another process.
pub(super) async fn deliver(child: &mut Child, flag: &'static str, signal: &SignalFn) {
    match (child.try_wait(), child.id()) {
        (Ok(None), Some(pid)) => {
            if !signal(pid, flag).await {
                tracing::warn!(pid, flag, "LSP signal failed");
            }
        }
        // Already exited; the monitor's `wait` arm reports it.
        (Ok(_), _) => {}
        (Err(err), _) => tracing::warn!(flag, ?err, "failed to check LSP server process"),
    }
}

pub(super) async fn wait_for_handle_exit(handle: &LspServerHandle, grace: Duration) -> bool {
    if handle.exited.load(Ordering::SeqCst) {
        return true;
    }
    let notified = handle.exit_notify.notified();
    tokio::pin!(notified);
    notified.as_mut().enable();
    handle.exited.load(Ordering::SeqCst) || tokio::time::timeout(grace, notified).await.is_ok()
}

impl ManagerState {
    pub(super) fn monitor_child(
        self: &Arc<Self>,
        key: String,
        mut child: Child,
        handle: Arc<LspServerHandle>,
        mut signals: mpsc::UnboundedReceiver<&'static str>,
    ) {
        let state = self.clone();
        tokio::spawn(async move {
            let status = loop {
                tokio::select! {
                    status = child.wait() => break status,
                    Some(flag) = signals.recv() => deliver(&mut child, flag, &state.signal).await,
                }
            };
            match status {
                Ok(status) => tracing::info!(
                    language = %handle.language, project_path = %handle.project_path,
                    code = ?status.code(), "LSP server exited"
                ),
                Err(err) => tracing::error!(
                    %err, language = %handle.language, project_path = %handle.project_path,
                    "LSP server process error"
                ),
            }
            handle.exited.store(true, Ordering::SeqCst);
            handle.exit_notify.notify_waiters();
            state.remove_handle(&key, &handle);
        });
    }
}
