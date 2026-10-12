use super::*;

impl ManagerState {
    pub(super) async fn get_or_spawn(
        self: &Arc<Self>,
        project_id: &str,
        language: &str,
        project_path: &str,
    ) -> Result<Arc<LspServerHandle>, LspError> {
        let mut shutdown = self.shutting_down.subscribe();
        if *shutdown.borrow() {
            return Err(LspError::ShuttingDown);
        }
        tokio::select! {
            biased;
            _ = shutdown.changed() => Err(LspError::ShuttingDown),
            result = self.spawn_single_flight(project_id, language, project_path) => result,
        }
    }

    async fn spawn_single_flight(
        self: &Arc<Self>,
        project_id: &str,
        language: &str,
        project_path: &str,
    ) -> Result<Arc<LspServerHandle>, LspError> {
        let k = key(project_id, language);
        loop {
            match self.guards.claim(&k) {
                Ok(_claim) => {
                    if let Some(existing) = self.handles.get(&k) {
                        let existing = existing.clone();
                        self.cancel_idle_timer(&existing);
                        if !existing.has_client() {
                            self.start_idle_timer(&k, &existing);
                        }
                        return Ok(existing);
                    }
                    return self.do_spawn(&k, language, project_path).await;
                }
                Err(waiter) => waiter.wait().await,
            }
        }
    }

    pub(super) async fn do_spawn(
        self: &Arc<Self>,
        k: &str,
        language: &str,
        project_path: &str,
    ) -> Result<Arc<LspServerHandle>, LspError> {
        let resolved = self
            .resolver
            .resolve_command(language, project_path)
            .await
            .ok_or_else(|| LspError::NotInstalled(language.to_string()))?;

        self.spawn_resolved(k, language, project_path, resolved)
    }

    fn spawn_resolved(
        self: &Arc<Self>,
        k: &str,
        language: &str,
        project_path: &str,
        resolved: ResolvedCommand,
    ) -> Result<Arc<LspServerHandle>, LspError> {
        let _gate = self.spawn_gate.lock_recover();
        if *self.shutting_down.borrow() {
            return Err(LspError::ShuttingDown);
        }
        tracing::info!(language, project_path, command = %resolved.command, "Spawning LSP server");

        let mut command = Command::new(&resolved.command);
        command
            .args(&resolved.args)
            .current_dir(project_path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        if let Some(path) = self.registry.resolved_path() {
            command.env("PATH", path);
        }
        let mut child = command.spawn()?;

        let (signal_tx, signal_rx) = mpsc::unbounded_channel();
        let handle = Arc::new(LspServerHandle::from_child(
            &mut child,
            language,
            project_path,
            signal_tx,
        ));
        self.handles.insert(k.to_string(), Arc::clone(&handle));
        self.start_idle_timer(k, &handle);
        self.monitor_child(k.to_string(), child, handle.clone(), signal_rx);
        Ok(handle)
    }
}
