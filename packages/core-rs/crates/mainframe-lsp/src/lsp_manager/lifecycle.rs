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

    async fn shutdown_handshake(&self, handle: &LspServerHandle) -> bool {
        if handle.exited.load(Ordering::SeqCst) {
            return true;
        }
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

            return wait_for_handle_exit(handle, self.shutdown_exit_timeout).await;
        }

        false
    }

    async fn escalate(&self, handle: &LspServerHandle) {
        handle.signal("-TERM");
        if !wait_for_handle_exit(handle, self.sigterm_grace).await {
            tracing::warn!(
                pid = handle.pid,
                "LSP server survived SIGTERM, sending SIGKILL"
            );
            handle.signal("-KILL");
            if !wait_for_handle_exit(handle, self.sigterm_grace).await {
                tracing::warn!(pid = handle.pid, "LSP server survived SIGKILL");
            }
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
                tracing::warn!(%err, "LSP shutdown task failed");
            }
        }
    }
}
