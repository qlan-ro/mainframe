use std::sync::Arc;

use mainframe_runtime::process::{Terminated, terminate_with};
use mainframe_types::sync::LockExt as _;
use tokio::task::JoinSet;

use super::ManagerState;
use super::handle::{ClientSlot, Inner, LspServerHandle, SHUTDOWN_REQUEST_ID};

impl ManagerState {
    /// Makes `slot` the handle's session and returns the one it replaces. A
    /// handle that is shutting down closes the new session at once.
    pub(crate) fn attach_client(
        &self,
        handle: &LspServerHandle,
        slot: ClientSlot,
    ) -> Option<ClientSlot> {
        let mut inner = handle.lock();
        if inner.closing {
            drop(inner);
            slot.close(1001, "LSP server exited");
            return None;
        }
        if let Some(timer) = inner.idle_timer.take() {
            timer.abort();
        }
        inner.client.replace(slot)
    }

    /// Detaches session `id` and re-arms the reaper, unless another session
    /// already replaced it.
    pub(crate) fn detach_client(self: &Arc<Self>, handle: &Arc<LspServerHandle>, id: u64) {
        let mut inner = handle.lock();
        if inner.client.as_ref().is_some_and(|client| client.id == id) {
            inner.client = None;
            self.arm_idle_timer(handle, &mut inner);
        }
    }

    /// Arms the reaper on a handle no session holds. Takes the locked state
    /// so a session cannot attach between the check and the arm.
    pub(super) fn arm_idle_timer(
        self: &Arc<Self>,
        handle: &Arc<LspServerHandle>,
        inner: &mut Inner,
    ) {
        if let Some(timer) = inner.idle_timer.take() {
            timer.abort();
        }
        if inner.client.is_some() || inner.closing {
            return;
        }
        let state = Arc::clone(self);
        let handle = Arc::downgrade(handle);
        let idle = self.timeouts.idle;
        inner.idle_timer = Some(tokio::spawn(async move {
            tokio::time::sleep(idle).await;
            if let Some(handle) = handle.upgrade() {
                state.reap_idle(&handle).await;
            }
        }));
    }

    async fn reap_idle(self: &Arc<Self>, handle: &Arc<LspServerHandle>) {
        {
            let mut inner = handle.lock();
            let current = inner
                .idle_timer
                .as_ref()
                .is_some_and(|timer| timer.id() == tokio::task::id());
            if !current || inner.client.is_some() {
                return;
            }
            // Drop this task's own handle rather than abort it: the shutdown
            // below cancels the idle timer, and aborting the running task
            // would stop the shutdown at its first await.
            inner.idle_timer = None;
        }
        tracing::info!(language = %handle.language, project_path = %handle.project_path, "LSP server idle, shutting down");
        self.shutdown_handle(handle).await;
    }

    /// Closes the session, then stops the child politely or by signal. A
    /// second caller waits for the first one's shutdown instead.
    pub(super) async fn shutdown_handle(self: &Arc<Self>, handle: &Arc<LspServerHandle>) {
        let Some((client, timer)) = handle.begin_close() else {
            self.await_shutdown(handle).await;
            return;
        };
        if let Some(timer) = timer {
            timer.abort();
        }
        if let Some(client) = client {
            client.close(1000, "LSP server shut down");
        }
        if !self.shutdown_handshake(handle).await {
            self.escalate(handle).await;
        }
        self.remove_handle(handle, 1000, "LSP server shut down");
    }

    /// Waits, bounded, for the shutdown that owns `handle`, then makes sure it
    /// is gone from the map.
    pub(super) async fn await_shutdown(&self, handle: &Arc<LspServerHandle>) {
        let budget = self.timeouts.shutdown_budget();
        if tokio::time::timeout(budget, handle.process.exit().wait())
            .await
            .is_err()
        {
            tracing::warn!(
                pid = handle.pid,
                "LSP server still running after its shutdown budget"
            );
        }
        self.remove_handle(handle, 1000, "LSP server shut down");
    }

    /// The `shutdown` request, a bounded wait for its acknowledgement, the
    /// `exit` notification and a bounded wait for the exit. `false` means the
    /// child must be signalled, including when its stdin queue is full or
    /// closed.
    async fn shutdown_handshake(&self, handle: &LspServerHandle) -> bool {
        let exit = handle.process.exit();
        if exit.exited() {
            return true;
        }
        handle.expect_shutdown_ack();
        let request = serde_json::json!({
            "jsonrpc": "2.0", "id": SHUTDOWN_REQUEST_ID, "method": "shutdown", "params": null
        });
        if !queue_handshake_message(handle, &request, "shutdown request") {
            return false;
        }
        tokio::select! {
            () = handle.shutdown_acked() => {}
            _ = exit.wait() => return true,
            () = tokio::time::sleep(self.timeouts.shutdown_request) => {
                tracing::debug!(pid = handle.pid, "LSP server did not acknowledge shutdown");
            }
        }
        let notification = serde_json::json!({ "jsonrpc": "2.0", "method": "exit" });
        if !queue_handshake_message(handle, &notification, "exit notification") {
            return false;
        }
        tokio::time::timeout(self.timeouts.shutdown_exit, exit.wait())
            .await
            .is_ok()
    }

    async fn escalate(&self, handle: &LspServerHandle) {
        let exit = handle.process.exit();
        let result = terminate_with(
            |kind| {
                handle.process.signal(kind);
                Ok(())
            },
            self.timeouts.sigterm_grace,
            async {
                exit.wait().await;
            },
        )
        .await;
        if !matches!(result, Ok(Terminated::Exited | Terminated::Killed)) {
            tracing::warn!(pid = handle.pid, "LSP server survived shutdown");
        }
    }

    /// Detaches the session and evicts the handle, unless a newer server
    /// already replaced it under the same key.
    pub(super) fn remove_handle(
        &self,
        handle: &Arc<LspServerHandle>,
        code: u16,
        reason: &'static str,
    ) {
        let (client, timer) = handle.begin_close().unwrap_or_default();
        if let Some(timer) = timer {
            timer.abort();
        }
        if let Some(client) = client {
            client.close(code, reason);
        }
        self.handles
            .remove_if(&handle.key, |_, current| Arc::ptr_eq(current, handle));
    }

    /// Stops every server concurrently, so one slow server does not stretch
    /// the others' grace periods.
    pub(super) async fn shutdown_all(self: &Arc<Self>) {
        let handles: Vec<_> = {
            let _gate = self.spawn_gate.lock_recover();
            self.shutting_down.send_replace(true);
            self.handles
                .iter()
                .map(|entry| entry.value().clone())
                .collect()
        };
        let mut shutdowns = JoinSet::new();
        for handle in handles {
            let state = Arc::clone(self);
            shutdowns.spawn(async move { state.shutdown_handle(&handle).await });
        }
        while let Some(result) = shutdowns.join_next().await {
            if let Err(error) = result {
                tracing::warn!(%error, "LSP shutdown task failed");
            }
        }
    }
}

fn queue_handshake_message(
    handle: &LspServerHandle,
    message: &serde_json::Value,
    what: &str,
) -> bool {
    match handle.try_write(&message.to_string()) {
        Ok(()) => true,
        Err(error) => {
            tracing::debug!(%error, pid = handle.pid, "LSP {what} not written; escalating");
            false
        }
    }
}
