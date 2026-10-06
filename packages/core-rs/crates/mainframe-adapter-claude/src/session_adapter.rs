use super::*;
impl AdapterSession for ClaudeSession {
    fn id(&self) -> &str {
        &self.id
    }
    fn adapter_id(&self) -> &str {
        "claude"
    }
    fn project_path(&self) -> &str {
        &self.project_path
    }
    fn is_spawned(&self) -> bool {
        ClaudeSession::is_spawned(self)
    }
    fn supports_replay_ack(&self) -> bool {
        true
    }
    fn last_activity_at(&self) -> Option<i64> {
        Some(ClaudeSession::last_activity_at(self))
    }
    fn spawn(
        &self,
        options: Option<SessionSpawnOptions>,
        sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        let options = options.unwrap_or(SessionSpawnOptions {
            model: None,
            permission_mode: None,
            plan_mode: None,
            executable_path: None,
            system_prompt: None,
            tuning: None,
            small_fast_model: None,
            default_model: None,
            no_persistence: None,
            orchestration_mcp: None,
        });
        Box::pin(ClaudeSession::spawn(self, options, sink))
    }
    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::kill(self))
    }
    fn get_process_info(&self) -> Option<AdapterProcess> {
        ClaudeSession::get_process_info(self)
    }
    fn send_message(
        &self,
        message: String,
        images: Vec<ImageInput>,
        uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::send_message(self, message, images, uuid))
    }
    fn supports_steer(&self) -> bool {
        true
    }
    fn steer(
        &self,
        message: String,
        uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::steer(self, message, uuid))
    }
    fn respond_to_permission(
        &self,
        response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::respond_to_permission(self, response))
    }
    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::interrupt(self))
    }
    fn model_requires_restart(&self, model: &str) -> bool {
        self.is_endpoint_session() != cliproxy::split_endpoint(model).0.is_some()
    }

    fn effective_model(&self) -> BoxFuture<'_, Option<String>> {
        Box::pin(async move {
            if !self.is_spawned() {
                return None;
            }
            let response = self
                .await_terminal(json!({"subtype": "get_settings"}), "get_settings")
                .await?;
            crate::effective_model::applied_model(&response).map(|model| {
                if self.is_endpoint_session() {
                    format!("{}/{model}", cliproxy::ENDPOINT_ID)
                } else {
                    model
                }
            })
        })
    }

    fn set_model(&self, model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::set_model(self, model))
    }
    fn set_permission_mode(&self, mode: ExecutionMode) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::set_permission_mode(self, mode))
    }
    fn set_plan_mode(&self, on: bool) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::set_plan_mode(self, on))
    }
    fn send_command(
        &self,
        command: String,
        args: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::send_command(
            self,
            command,
            args.unwrap_or_default(),
        ))
    }
    fn cancel_queued_message(&self, uuid: String) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(ClaudeSession::cancel_queued_message(self, uuid))
    }
    fn get_context_files(&self) -> ContextFiles {
        ClaudeSession::get_context_files(self)
    }
    fn load_history(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>> {
        Box::pin(ClaudeSession::load_history(self))
    }
    fn history_sources(&self) -> BoxFuture<'_, Vec<std::path::PathBuf>> {
        Box::pin(ClaudeSession::history_sources(self))
    }
    fn extract_plan_files(&self) -> BoxFuture<'_, Result<Vec<String>, AdapterError>> {
        Box::pin(ClaudeSession::extract_plan_files(self))
    }
    fn extract_skill_files(&self) -> BoxFuture<'_, Result<Vec<SkillFileEntry>, AdapterError>> {
        Box::pin(ClaudeSession::extract_skill_files(self))
    }
    fn stop_background_task(
        &self,
        task_id: String,
    ) -> BoxFuture<'_, Result<StopBackgroundTaskResult, AdapterError>> {
        Box::pin(ClaudeSession::stop_background_task(self, task_id))
    }
    fn apply_tuning(&self, tuning: ResolvedTuning) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::apply_tuning(self, tuning))
    }
}
