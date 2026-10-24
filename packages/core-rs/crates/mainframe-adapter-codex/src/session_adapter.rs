use super::*;
use tracing::Instrument as _;
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
        self.client.lock_recover().is_some()
    }

    fn get_process_info(&self) -> Option<AdapterProcess> {
        if self.client.lock_recover().is_none() {
            return None;
        }
        let chat_id = self
            .state
            .lock_recover()
            .thread_id
            .clone()
            .unwrap_or_default();
        Some(AdapterProcess {
            id: self.id.clone(),
            adapter_id: "codex".to_string(),
            chat_id,
            pid: self.pid.load(Ordering::SeqCst),
            status: *self.status.lock_recover(),
            project_path: self.project_path.clone(),
            model: self.config.lock_recover().model.clone(),
        })
    }

    fn spawn(
        &self,
        options: Option<SessionSpawnOptions>,
        sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        Box::pin((self.spawn_inner(options, sink)).instrument(self.span.clone()))
    }

    fn send_message(
        &self,
        message: String,
        images: Vec<ImageInput>,
        _uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin((self.send_message_inner(message, images, _uuid)).instrument(self.span.clone()))
    }

    fn supports_steer(&self) -> bool {
        true
    }

    fn steer(
        &self,
        message: String,
        _uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin((self.steer_inner(message)).instrument(self.span.clone()))
    }

    fn cancel_queued_message(&self, _uuid: String) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin((async { Ok(false) }).instrument(self.span.clone()))
    }

    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin((self.kill_inner()).instrument(self.span.clone()))
    }

    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin((self.interrupt_inner()).instrument(self.span.clone()))
    }

    fn respond_to_permission(
        &self,
        response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(
            (async move {
                if let Some(approval) = self.approval_handler.lock_recover().as_ref() {
                    approval.resolve(&response).map_err(AdapterError::from)?;
                }
                Ok(())
            })
            .instrument(self.span.clone()),
        )
    }

    fn effective_model(&self) -> BoxFuture<'_, Option<String>> {
        Box::pin((self.read_effective_model()).instrument(self.span.clone()))
    }

    fn set_model(&self, model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(
            (async move {
                let model = match model::explicit_model(Some(&model)) {
                    Some(model) => model,
                    None => self.configured_cli_model().await?,
                };
                self.config.lock_recover().model = Some(model);
                Ok(())
            })
            .instrument(self.span.clone()),
        )
    }

    fn set_permission_mode(&self, mode: ExecutionMode) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(
            (async move {
                self.config.lock_recover().permission_mode = mode;
                Ok(())
            })
            .instrument(self.span.clone()),
        )
    }

    fn set_plan_mode(&self, on: bool) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(
            (async move {
                self.config.lock_recover().plan_mode = on;
                Ok(())
            })
            .instrument(self.span.clone()),
        )
    }

    fn apply_tuning(&self, tuning: ResolvedTuning) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(
            (async move {
                self.config.lock_recover().tuning = Some(tuning);
                Ok(())
            })
            .instrument(self.span.clone()),
        )
    }

    fn send_command(
        &self,
        _command: String,
        _args: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(
            (async move {
                tracing::warn!(session_id = %self.id, "sendCommand not supported");
                Ok(())
            })
            .instrument(self.span.clone()),
        )
    }

    fn get_context_files(&self) -> ContextFiles {
        crate::context_files::collect_codex_context_files(&self.project_path)
    }

    fn load_history(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>> {
        Box::pin((self.load_history_inner()).instrument(self.span.clone()))
    }

    fn history_dependencies(&self) -> Option<Vec<mainframe_adapter_api::HistoryDependency>> {
        self.history_dependencies.lock_recover().clone()
    }

    fn history_state(&self) -> serde_json::Value {
        self.history_state.lock_recover().clone()
    }

    fn validate_history_state<'a>(&'a self, state: &'a serde_json::Value) -> BoxFuture<'a, bool> {
        Box::pin(crate::thread_registry::metadata_matches(state))
    }

    fn history_sources(&self) -> BoxFuture<'_, Vec<std::path::PathBuf>> {
        Box::pin((self.history_sources_inner()).instrument(self.span.clone()))
    }

    fn load_scan_records<'a>(
        &'a self,
        _canonical: Option<&'a [ChatMessage]>,
    ) -> BoxFuture<'a, Result<std::borrow::Cow<'a, [ChatMessage]>, AdapterError>> {
        Box::pin(
            async {
                self.load_scan_records_inner()
                    .await
                    .map(std::borrow::Cow::Owned)
            }
            .instrument(self.span.clone()),
        )
    }

    fn extract_plan_files(&self) -> BoxFuture<'_, Result<Vec<String>, AdapterError>> {
        Box::pin((async { Ok(Vec::new()) }).instrument(self.span.clone()))
    }

    fn extract_skill_files(&self) -> BoxFuture<'_, Result<Vec<SkillFileEntry>, AdapterError>> {
        Box::pin((async { Ok(Vec::new()) }).instrument(self.span.clone()))
    }

    fn stop_background_task(
        &self,
        _task_id: String,
    ) -> BoxFuture<'_, Result<StopBackgroundTaskResult, AdapterError>> {
        Box::pin(
            (async {
                Ok(StopBackgroundTaskResult {
                    ok: false,
                    error: Some("unsupported".to_string()),
                })
            })
            .instrument(self.span.clone()),
        )
    }
}
