use super::*;

/// The production [`SignalFn`]: direct delivery to the pid.
pub(super) fn kill_signal() -> SignalFn {
    use mainframe_runtime::process::{Target, signal};
    Arc::new(|pid, kind| {
        Box::pin(async move {
            match signal(Target::Pid(pid), kind) {
                Ok(delivered) => delivered,
                Err(error) => {
                    tracing::warn!(pid, ?kind, %error, "LSP signal failed");
                    false
                }
            }
        })
    })
}

/// Deliver `kind` to the monitored child, but only while it is unreaped: until
/// `wait` collects it, its pid cannot be reused by another process.
pub(super) async fn deliver(child: &mut Child, kind: Signal, signal: &SignalFn) {
    match (child.try_wait(), child.id()) {
        (Ok(None), Some(pid)) => {
            if !signal(pid, kind).await {
                tracing::warn!(pid, ?kind, "LSP signal failed");
            }
        }
        // Already exited; the monitor's `wait` arm reports it.
        (Ok(_), _) => {}
        (Err(err), _) => tracing::warn!(?kind, ?err, "failed to check LSP server process"),
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
        mut signals: mpsc::UnboundedReceiver<Signal>,
    ) {
        let state = self.clone();
        tokio::spawn(async move {
            let status = loop {
                tokio::select! {
                    status = child.wait() => break status,
                    Some(kind) = signals.recv() => deliver(&mut child, kind, &state.signal).await,
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
