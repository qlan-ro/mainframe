use super::*;

impl TunnelManager {
    /// Hand a spawned child to the watcher task that owns it until it is reaped.
    /// The watcher records the pid so a crashed daemon's next startup sweep can
    /// reap it (absolute paths only — reaping a bare-name match could kill an
    /// unrelated process after PID reuse), delivers signals, and on exit forgets
    /// the record, leaves `live`, and publishes the exit.
    pub(super) fn watch_child(&self, mut child: Child, label: &str) -> TunnelProcess {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let pid = child.id();
        let record = tunnel_record_entry(&self.config.cloudflared_bin, pid, label);
        let (signals, mut signal_rx) = mpsc::unbounded_channel();
        let (exit_tx, exit) = watch::channel(None);
        let process = TunnelProcess {
            id,
            label: label.to_string(),
            pid,
            signals,
            exit,
            stopping: Arc::new(AtomicBool::new(false)),
        };
        self.lock_live().insert(id, process.clone());

        let live = self.live.clone();
        let registry = self.registry.clone();
        let signal = self.signal.clone();
        tokio::spawn(async move {
            let recorded = record.as_ref().map(|entry| entry.pid);
            if let Some(entry) = record {
                registry.add(entry).await;
            }
            let status = loop {
                tokio::select! {
                    status = child.wait() => break status,
                    Some(flag) = signal_rx.recv() => deliver(&mut child, pid, flag, &signal).await,
                }
            };
            let code = match status {
                Ok(status) => {
                    if let Some(pid) = recorded {
                        registry.remove(pid).await;
                    }
                    status.code()
                }
                Err(err) => {
                    tracing::warn!(target: "tunnel", ?pid, ?err, "failed to reap tunnel process");
                    None
                }
            };
            live.lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(&id);
            exit_tx.send_replace(Some(TunnelExit { code }));
        });
        process
    }
}
