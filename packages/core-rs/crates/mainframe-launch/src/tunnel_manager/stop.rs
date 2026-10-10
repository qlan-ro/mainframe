use super::*;

impl TunnelManager {
    /// Terminate `process` (SIGTERM, then SIGKILL after `stop_grace`) and, for a
    /// listed tunnel, broadcast `stopped` once it has exited. A task, so the
    /// escalation completes even if the caller is cancelled.
    pub(super) fn spawn_stop(
        &self,
        label: Option<String>,
        process: TunnelProcess,
    ) -> JoinHandle<()> {
        let grace = self.config.stop_grace;
        let broadcast = self.broadcast.clone();
        tokio::spawn(async move {
            process.terminate(grace).await;
            if let Some(label) = label.filter(|_| process.exit.borrow().is_some()) {
                tracing::info!(target: "tunnel", label = %label, "tunnel stopped");
                broadcast(DaemonEvent::TunnelStatus {
                    state: TunnelState::Stopped,
                    label,
                    url: None,
                    dns_verified: None,
                    error: None,
                });
            }
        })
    }

    /// Stop every unreaped child for this label, including starts and concurrent stops.
    pub async fn stop(&self, label: &str) {
        self.verified_at.remove(label);
        let listed = self.tunnels.remove(label).map(|(_, tunnel)| tunnel.process);
        let mut processes: Vec<_> = self
            .lock_live()
            .values()
            .filter(|process| process.label == label)
            .cloned()
            .collect();
        if let Some(process) = &listed
            && !processes.iter().any(|live| live.id == process.id)
        {
            processes.push(process.clone());
        }
        let mut tasks = Vec::new();
        for process in processes {
            let event_label = listed
                .as_ref()
                .filter(|p| p.id == process.id)
                .map(|_| label.to_string());
            tasks.push(self.spawn_stop(event_label, process));
        }
        for task in tasks {
            if let Err(err) = task.await {
                tracing::warn!(target: "tunnel", ?err, "tunnel stop task failed");
            }
        }
    }

    /// Stop every tunnel — running, still starting, or already being stopped —
    /// and return once each cloudflared child has exited.
    pub async fn stop_all(&self) {
        self.verified_at.clear();
        let labels: Vec<String> = self.tunnels.iter().map(|e| e.key().clone()).collect();
        let mut stopping = Vec::new();
        let mut listed = HashSet::new();
        for label in labels {
            if let Some((label, tunnel)) = self.tunnels.remove(&label) {
                listed.insert(tunnel.process.id);
                stopping.push(self.spawn_stop(Some(label), tunnel.process));
            }
        }
        let unlisted: Vec<TunnelProcess> = self
            .lock_live()
            .values()
            .filter(|process| !listed.contains(&process.id))
            .cloned()
            .collect();
        for process in unlisted {
            stopping.push(self.spawn_stop(None, process));
        }
        for task in stopping {
            if let Err(err) = task.await {
                tracing::warn!(target: "tunnel", ?err, "tunnel stop task failed");
            }
        }
    }

    /// Best-effort SIGTERM to every live child from a panic hook, which can
    /// neither await the watchers nor block on a lock the panicking thread holds.
    pub fn signal_all_on_panic(&self) {
        let live = match self.live.try_lock() {
            Ok(live) => live,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(TryLockError::WouldBlock) => return,
        };
        for pid in live.values().filter_map(|process| process.pid) {
            crate::process::sweep::default_kill(i64::from(pid), "SIGTERM", false);
        }
    }
}
