use super::*;
impl AdapterSession for CodexSession {
    fn id(&self) -> &str {
        &self.id
    }
    fn adapter_id(&self) -> &str {
        "codex"
    }
    fn project_path(&self) -> &str {
        &self.project_path
    }
    fn is_spawned(&self) -> bool {
        self.client
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some()
    }

    fn get_process_info(&self) -> Option<AdapterProcess> {
        if self
            .client
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_none()
        {
            return None;
        }
        let chat_id = self
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .thread_id
            .clone()
            .unwrap_or_default();
        Some(AdapterProcess {
            id: self.id.clone(),
            adapter_id: "codex".to_string(),
            chat_id,
            pid: self.pid.load(Ordering::SeqCst),
            status: *self.status.lock().unwrap_or_else(|e| e.into_inner()),
            project_path: self.project_path.clone(),
            model: self
                .config
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .model
                .clone(),
        })
    }

    fn spawn(
        &self,
        options: Option<SessionSpawnOptions>,
        sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        Box::pin(self.spawn_inner(options, sink))
    }

    fn send_message(
        &self,
        message: String,
        images: Vec<ImageInput>,
        _uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(self.send_message_inner(message, images, _uuid))
    }

    fn supports_steer(&self) -> bool {
        true
    }

    fn steer(
        &self,
        message: String,
        _uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(self.steer_inner(message))
    }

    fn cancel_queued_message(&self, _uuid: String) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(false) })
    }

    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(self.kill_inner())
    }

    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(self.interrupt_inner())
    }

    fn respond_to_permission(
        &self,
        response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            if let Some(approval) = self
                .approval_handler
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
            {
                approval.resolve(&response);
            }
            Ok(())
        })
    }

    fn effective_model(&self) -> BoxFuture<'_, Option<String>> {
        Box::pin(self.read_effective_model())
    }

    fn set_model(&self, model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            let model = match model::explicit_model(Some(&model)) {
                Some(model) => model,
                None => self.configured_cli_model().await?,
            };
            self.config.lock().unwrap_or_else(|e| e.into_inner()).model = Some(model);
            Ok(())
        })
    }

    fn set_permission_mode(&self, mode: ExecutionMode) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            self.config
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .permission_mode = mode;
            Ok(())
        })
    }

    fn set_plan_mode(&self, on: bool) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            self.config
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .plan_mode = on;
            Ok(())
        })
    }

    fn apply_tuning(&self, tuning: ResolvedTuning) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            self.config.lock().unwrap_or_else(|e| e.into_inner()).tuning = Some(tuning);
            Ok(())
        })
    }

    fn send_command(
        &self,
        _command: String,
        _args: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            tracing::warn!(module = "codex:session", session_id = %self.id, "codex: sendCommand not supported");
            Ok(())
        })
    }

    fn get_context_files(&self) -> ContextFiles {
        crate::context_files::collect_codex_context_files(&self.project_path)
    }

    fn load_history(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>> {
        Box::pin(self.load_history_inner())
    }

    fn history_sources(&self) -> BoxFuture<'_, Vec<std::path::PathBuf>> {
        Box::pin(self.history_sources_inner())
    }

    fn load_scan_records(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>> {
        Box::pin(self.load_scan_records_inner())
    }

    fn extract_plan_files(&self) -> BoxFuture<'_, Result<Vec<String>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn extract_skill_files(&self) -> BoxFuture<'_, Result<Vec<SkillFileEntry>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn stop_background_task(
        &self,
        _task_id: String,
    ) -> BoxFuture<'_, Result<StopBackgroundTaskResult, AdapterError>> {
        Box::pin(async {
            Ok(StopBackgroundTaskResult {
                ok: false,
                error: Some("unsupported".to_string()),
            })
        })
    }
}
