//! Lifecycle and permission delegations off the `ChatManager` facade.
use super::*;

impl ChatManager {
    pub async fn create_chat(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
    ) -> Chat {
        self.lifecycle
            .create_chat(
                project_id,
                adapter_id,
                model,
                permission_mode,
                None,
                None,
                None,
            )
            .await
    }

    /// `createChatWithDefaults` — like `create_chat` but fills unset model/mode/
    /// plan-mode from the adapter's persisted provider defaults. Backs
    /// `POST /api/chats`.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_chat_with_defaults(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
        worktree_path: Option<&str>,
        branch_name: Option<&str>,
        automation_run_id: Option<&str>,
    ) -> Chat {
        self.lifecycle
            .create_chat_with_defaults(
                project_id,
                adapter_id,
                model,
                permission_mode,
                worktree_path,
                branch_name,
                automation_run_id,
            )
            .await
    }

    pub async fn resume_chat(&self, chat_id: &str) {
        self.lifecycle.resume_chat(chat_id).await;
    }

    /// Trust the chat's workspace in `~/.claude.json` (path derived server-side
    /// from the chat). Backs `POST /api/chats/:id/trust-workspace`.
    pub async fn trust_workspace(&self, chat_id: &str) -> Result<(), TrustWorkspaceError> {
        let chat = self
            .deps
            .chats_get(chat_id)
            .ok_or_else(|| TrustWorkspaceError::ChatNotFound(chat_id.to_string()))?;
        let project_path = self
            .deps
            .projects_get_path(&chat.project_id)
            .ok_or_else(|| TrustWorkspaceError::ProjectNotFound(chat.project_id.clone()))?;
        let effective_path = chat.worktree_path.unwrap_or(project_path);
        self.deps
            .write_workspace_trust(&effective_path)
            .await
            .map_err(TrustWorkspaceError::Write)
    }

    pub async fn load_chat(&self, chat_id: &str) {
        self.lifecycle.load_chat(chat_id).await;
    }

    pub async fn start_chat(&self, chat_id: &str) {
        self.lifecycle.start_chat(chat_id).await;
    }

    pub async fn interrupt_chat(&self, chat_id: &str) {
        self.lifecycle.interrupt_chat(chat_id).await;
    }

    pub async fn archive_chat(&self, chat_id: &str, delete_worktree: bool) {
        self.lifecycle.archive_chat(chat_id, delete_worktree).await;
        self.deps.tracker_remove_chat(chat_id);
        self.event_handler.clear_display_cache(chat_id);
        self.worktree_offers.forget(chat_id);
    }

    pub async fn end_chat(&self, chat_id: &str) {
        self.lifecycle.end_chat(chat_id).await;
        self.deps.tracker_remove_chat(chat_id);
        self.event_handler.clear_display_cache(chat_id);
        self.worktree_offers.forget(chat_id);
    }

    pub fn unarchive_chat(&self, chat_id: &str) -> Option<Chat> {
        self.deps.chats_update(
            chat_id,
            &ChatUpdate {
                status: Some(mainframe_types::chat::ChatStatus::Active),
                ..Default::default()
            },
        );
        let chat = self.deps.chats_get(chat_id)?;
        self.emit(DaemonEvent::ChatUpdated {
            chat: chat.clone(),
            reason: None,
        });
        Some(chat)
    }

    pub fn rename_chat(&self, chat_id: &str, title: &str) {
        self.deps.chats_update(
            chat_id,
            &ChatUpdate {
                title: Some(title.to_string()),
                ..Default::default()
            },
        );
        if let Some(cell) = self.get_active(chat_id) {
            cell.lock().unwrap_or_else(|e| e.into_inner()).chat.title = Some(title.to_string());
        }
        if let Some(chat) = self.deps.chats_get(chat_id) {
            self.emit(DaemonEvent::ChatUpdated { chat, reason: None });
        }
    }

    pub async fn respond_to_permission(
        &self,
        chat_id: &str,
        response: ControlResponse,
    ) -> Result<(), PermissionError> {
        info!(
            chat_id,
            behavior = ?response.behavior,
            tool_name = ?response.tool_name,
            "permission answered"
        );
        self.permission_handler
            .respond_to_permission(chat_id, response)
            .await
    }

    pub async fn get_pending_permission(
        &self,
        chat_id: &str,
    ) -> Option<mainframe_types::adapter::ControlRequest> {
        self.permission_handler
            .get_pending_permission(chat_id)
            .await
    }

    pub fn has_pending_permission(&self, chat_id: &str) -> bool {
        self.permission_handler.has_pending_permission(chat_id)
    }

    pub fn clear_pending_permission(&self, chat_id: &str) {
        self.permission_handler.clear_pending_permission(chat_id);
    }
}
