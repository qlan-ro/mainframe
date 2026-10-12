use super::*;

impl ManagerState {
    /// Removes a handle. Guards on identity so a dying old child never
    /// evicts a freshly respawned handle under the same key.
    pub(super) fn remove_handle(&self, k: &str, handle: &Arc<LspServerHandle>) {
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

    pub(super) fn start_idle_timer(self: &Arc<Self>, k: &str, handle: &Arc<LspServerHandle>) {
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

    pub(super) fn cancel_idle_timer(&self, handle: &Arc<LspServerHandle>) {
        if let Some(timer) = handle.lock_inner().idle_timer.take() {
            timer.abort();
        }
    }

    pub(super) async fn shutdown(self: &Arc<Self>, project_id: &str, language: &str) {
        let k = key(project_id, language);
        let Some(handle) = self.handles.get(&k).map(|h| h.clone()) else {
            return;
        };

        self.cancel_idle_timer(&handle);
        handle.set_cleanup(None);

        if !self.shutdown_handshake(&handle).await {
            self.escalate(&handle).await;
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

    /// The polite LSP shutdown: `shutdown` request, a bounded wait for its ack,
    /// `exit` notification, a bounded wait for the exit. Returns `false` when
    /// the server must be escalated to signals instead, including when its
    /// stdin queue is full or closed: a server that stopped reading stdin
    /// would otherwise hold the handshake forever.
    async fn shutdown_handshake(&self, handle: &LspServerHandle) -> bool {
        if handle.exited.load(Ordering::SeqCst) {
            return true;
        }
        let shutdown_req = serde_json::json!({
            "jsonrpc": "2.0", "id": "shutdown", "method": "shutdown", "params": null
        })
        .to_string();
        if !queue_handshake_message(handle, &shutdown_req, "shutdown request") {
            return false;
        }

        if let Some(mut stdout) = handle.take_stdout() {
            let mut buf = [0u8; 8192];
            // The ack, EOF, a read error or the timeout all move on to `exit`.
            /* expected */
            let _ =
                tokio::time::timeout(self.shutdown_request_timeout, stdout.read(&mut buf)).await;
        } else {
            tokio::time::sleep(self.shutdown_request_timeout).await;
        }

        let exit_notif = serde_json::json!({ "jsonrpc": "2.0", "method": "exit" }).to_string();
        if !queue_handshake_message(handle, &exit_notif, "exit notification") {
            return false;
        }

        wait_for_handle_exit(handle, self.shutdown_exit_timeout).await
    }

    async fn escalate(&self, handle: &LspServerHandle) {
        use mainframe_runtime::process::{Terminated, terminate_with};
        let result = terminate_with(
            |kind| {
                handle.signal(kind);
                Ok(())
            },
            self.sigterm_grace,
            async {
                loop {
                    let notified = handle.exit_notify.notified();
                    tokio::pin!(notified);
                    notified.as_mut().enable();
                    if handle.exited.load(Ordering::SeqCst) {
                        break;
                    }
                    notified.await;
                }
            },
        )
        .await;
        if !matches!(result, Ok(Terminated::Exited | Terminated::Killed)) {
            tracing::warn!(pid = handle.pid, "LSP server survived shutdown");
        }
    }

    /// Shut every server down concurrently, so one slow server does not
    /// stretch the others' grace periods.
    pub(super) async fn shutdown_all(self: &Arc<Self>) {
        let keys: Vec<String> = {
            let _gate = self.spawn_gate.lock_recover();
            self.shutting_down.send_replace(true);
            self.handles.iter().map(|e| e.key().clone()).collect()
        };
        let tasks: Vec<_> = keys
            .into_iter()
            .map(|k| {
                let state = Arc::clone(self);
                tokio::spawn(async move {
                    let (project_id, language) = split_key(&k);
                    state.shutdown(&project_id, &language).await;
                })
            })
            .collect();
        for task in tasks {
            if let Err(err) = task.await {
                tracing::warn!(error = %err, "LSP shutdown task failed");
            }
        }
    }
}

/// Queue one handshake message without waiting for queue room.
fn queue_handshake_message(handle: &LspServerHandle, json: &str, what: &str) -> bool {
    match handle
        .stdin_tx
        .try_write(encode_json_rpc(json).into_bytes())
    {
        Ok(()) => true,
        Err(error) => {
            tracing::debug!(%error, pid = handle.pid, "LSP {what} not written; escalating");
            false
        }
    }
}
