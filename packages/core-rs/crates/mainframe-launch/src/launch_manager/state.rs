use super::*;

impl Inner {
    /// Persist a spawned launch pid so a crashed daemon's next startup sweep can
    /// reap its process group. Identity is the child's LIVE command line, read
    /// from `ps` at spawn — the kernel rewrites argv for a `#!` script, which is
    /// what the sweep reads back, so recording our own argv would never match. If
    /// `ps` can't read the pid we fall back to the spawned argv (a weaker guard).
    /// The cwd is recorded as a realpath so it matches `lsof`'s resolved path.
    async fn record_spawn(&self, name: &str, pid: Option<u32>, executable: &str, args: &[String]) {
        let Some(pid) = pid else {
            return;
        };
        let Some(registry) = &self.child_registry else {
            return;
        };
        let cwd = tokio::fs::canonicalize(&self.project_path)
            .await
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| self.project_path.clone());
        let live = (self.read_process_command)(i64::from(pid)).await;
        let (command, recorded_args) = match live {
            Some(live) => (live, Vec::new()),
            None => (executable.to_string(), args.to_vec()),
        };
        registry
            .add(ManagedChildEntry {
                pid: i64::from(pid),
                kind: ManagedChildKind::Launch,
                command,
                args: recorded_args,
                cwd: Some(cwd),
                group: true,
                label: format!("{}:{}", self.project_id, name),
                spawned_at: now_ms(),
            })
            .await;
    }

    fn forget_spawn(&self, pid: Option<u32>) {
        let Some(pid) = pid else {
            return;
        };
        let Some(registry) = &self.child_registry else {
            return;
        };
        let registry = registry.clone();
        tokio::spawn(async move {
            registry.remove(i64::from(pid)).await;
        });
    }

    fn emit_status(&self, name: &str, status: LaunchProcessStatus) {
        (self.on_event)(DaemonEvent::LaunchStatus {
            project_id: self.project_id.clone(),
            effective_path: self.project_path.clone(),
            name: name.to_string(),
            status,
        });
    }

    fn emit_output(&self, name: &str, data: String, stream: LaunchStream) {
        (self.on_event)(DaemonEvent::LaunchOutput {
            project_id: self.project_id.clone(),
            effective_path: self.project_path.clone(),
            name: name.to_string(),
            data,
            stream,
        });
    }
}
