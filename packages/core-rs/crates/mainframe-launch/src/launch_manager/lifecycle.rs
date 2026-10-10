use super::*;

impl LaunchManager {
    pub async fn stop(&self, name: &str) {
        let inner = &self.inner;
        let (status, pid, mut exit_rx) = {
            let Some(managed) = inner.processes.get(name) else {
                return;
            };
            (managed.status.clone(), managed.pid, managed.exit_rx.clone())
        };

        *status.lock_recover() = LaunchProcessStatus::Stopped;
        inner.state.set_status(name, LaunchProcessStatus::Stopped);
        inner.emit_status(name, LaunchProcessStatus::Stopped);

        // The preview tunnel and the process group stop concurrently, so a
        // stubborn one does not delay the other's grace period.
        let stop_tunnel = async {
            if let Some(tm) = &inner.tunnel_manager {
                tm.stop(&format!("preview:{name}")).await;
            }
        };
        let stop_process = async {
            // Kill the entire process group (pnpm/tsx spawn child trees).
            kill_process(pid, "-TERM").await;
            tracing::info!(target: "launch", name, pid = ?pid, "stopping launch process (SIGTERM)");

            if tokio::time::timeout(inner.timings.stop_grace, wait_until_exited(&mut exit_rx))
                .await
                .is_err()
            {
                tracing::warn!(target: "launch", name, "process did not exit after SIGTERM, sending SIGKILL");
                kill_process(pid, "-KILL").await;
                wait_until_exited(&mut exit_rx).await;
            }
        };
        tokio::join!(stop_tunnel, stop_process);
        tracing::info!(target: "launch", name, pid = ?pid, "launch process stopped");
    }

    pub async fn stop_all(&self) {
        let names: Vec<String> = self
            .inner
            .processes
            .iter()
            .map(|e| e.key().clone())
            .collect();
        let mut tasks = tokio::task::JoinSet::new();
        for name in names {
            let manager = Self {
                inner: self.inner.clone(),
                spawn_gate: self.spawn_gate.clone(),
            };
            tasks.spawn(async move { manager.stop(&name).await });
        }
        while let Some(result) = tasks.join_next().await {
            if let Err(err) = result {
                tracing::warn!(?err, "launch stop task failed");
            }
        }
    }

    pub fn get_status(&self, name: &str) -> LaunchProcessStatus {
        self.inner.state.get_status(name)
    }

    pub fn get_all_statuses(&self) -> HashMap<String, LaunchProcessStatus> {
        self.inner.state.get_all_statuses()
    }

    /// Buffered stdout/stderr for a config, oldest first.
    pub fn get_output_buffer(&self, name: &str) -> Vec<LaunchOutputEntry> {
        self.inner.state.get_output_buffer(name)
    }
}
