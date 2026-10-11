use super::*;

impl ChatLifecycleManager {
    pub(super) async fn session_spawn_options(
        &self,
        chat_id: &str,
        chat: &Chat,
        no_persistence: bool,
    ) -> SessionSpawnOptions {
        let executable_path = self
            .provider_setting(&chat.adapter_id, "executablePath")
            .await;
        let system_prompt = self
            .provider_setting(&chat.adapter_id, "systemPrompt")
            .await;
        let small_fast_model = self
            .provider_setting(&chat.adapter_id, "cliproxySmallFastModel")
            .await;
        let tuning = self.shared.deps.resolve_tuning(chat_id).await;
        let default_model = self.default_model_for(&chat.adapter_id).await;

        SessionSpawnOptions {
            model: chat.model.clone().or_else(|| default_model.clone()),
            permission_mode: chat.permission_mode,
            plan_mode: Some(chat.plan_mode.unwrap_or(false)),
            executable_path,
            system_prompt,
            tuning,
            small_fast_model,
            default_model,
            no_persistence: Some(no_persistence),
            orchestration_mcp: None,
        }
    }

    pub(super) fn create_start_session(
        &self,
        chat_id: &str,
        chat: &Chat,
        cwd: String,
    ) -> Result<Arc<dyn mainframe_adapter_api::AdapterSession>, LifecycleError> {
        let fork_source = self
            .shared
            .deps
            .get_pending_fork(chat_id)?
            .map(|pending| pending.fork_source);
        let session = self
            .shared
            .deps
            .create_session(
                &chat.adapter_id,
                SessionOptions {
                    project_path: cwd,
                    chat_id: chat.vendor_session_id.clone(),
                    mainframe_chat_id: chat_id.to_string(),
                    session_file_path: chat.session_file_path.clone(),
                    fork_source,
                },
            )
            .ok_or_else(|| NotFound::new("Adapter", chat.adapter_id.clone()))?;
        Ok(session)
    }

    pub(super) async fn finish_archive(&self, chat_id: &str) {
        self.shared.deps.attachment_delete_chat(chat_id).await;
        self.shared.best_effort(
            chat_id,
            self.shared.deps.chats_update(
                chat_id,
                &ChatPatch {
                    status: Some(ChatStatus::Archived),
                    ..Default::default()
                },
            ),
            (),
        );
        info!(chat_id, "chat archived");
        self.shared.emit(DaemonEvent::ChatEnded {
            chat_id: chat_id.to_string(),
        });
    }
}
