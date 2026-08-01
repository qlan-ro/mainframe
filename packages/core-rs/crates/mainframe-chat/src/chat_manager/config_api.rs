//! Config and worktree delegations off the `ChatManager` facade.
use super::*;

impl ChatManager {
    pub async fn update_chat_config(
        &self,
        chat_id: &str,
        adapter_id: Option<String>,
        model: Option<String>,
        permission_mode: Option<ExecutionMode>,
        plan_mode: Option<bool>,
    ) -> Result<(), ConfigError> {
        self.config
            .update_chat_config(chat_id, adapter_id, model, permission_mode, plan_mode)
            .await
    }

    /// Every worktree rebind below stops and restarts the CLI, so each refuses
    /// while a turn is in flight rather than cutting the answer off.
    pub async fn enable_worktree(
        &self,
        chat_id: &str,
        base_branch: &str,
        branch_name: &str,
    ) -> Result<(), ConfigError> {
        if self.is_chat_working(chat_id) {
            return Err(ConfigError::ChatBusy);
        }
        self.config
            .enable_worktree(chat_id, base_branch, branch_name)
            .await
    }

    pub async fn attach_worktree(
        &self,
        chat_id: &str,
        worktree_path: &str,
        branch_name: Option<&str>,
    ) -> Result<(), ConfigError> {
        if self.is_chat_working(chat_id) {
            return Err(ConfigError::ChatBusy);
        }
        self.config
            .attach_worktree(chat_id, worktree_path, branch_name)
            .await
    }

    pub fn worktree_offers_for_chat(&self, chat_id: &str) -> Vec<WorktreeSwitchOffer> {
        self.worktree_offers.snapshot(chat_id)
    }

    pub fn dismiss_worktree_offer(
        &self,
        chat_id: &str,
        worktree_path: &str,
    ) -> Result<(), OfferError> {
        self.worktree_offers.dismiss(chat_id, worktree_path)
    }

    /// Claims the one switch slot, rebinds, then releases it. The `resolved`
    /// event comes from `on_binding_changed`, never from here.
    pub async fn accept_worktree_offer(
        &self,
        chat_id: &str,
        worktree_path: &str,
    ) -> Result<(), OfferError> {
        // The rebind restarts the CLI, which would kill a turn mid-answer and
        // lose whatever it had not written yet. The offer keeps.
        if self.is_chat_working(chat_id) {
            return Err(OfferError::ChatBusy);
        }
        let offer = self.worktree_offers.claim_accept(chat_id, worktree_path)?;

        if tokio::fs::metadata(worktree_path).await.is_err() {
            self.worktree_offers.release_accept(chat_id);
            self.worktree_offers.expire(chat_id, worktree_path);
            return Err(OfferError::Vanished);
        }

        let result = self
            .config
            .attach_worktree(chat_id, worktree_path, offer.branch_name.as_deref())
            .await;
        self.worktree_offers.release_accept(chat_id);
        result.map_err(|err| OfferError::Message(err.to_string()))
    }

    pub async fn disable_worktree(&self, chat_id: &str) -> Result<(), ConfigError> {
        if self.is_chat_working(chat_id) {
            return Err(ConfigError::ChatBusy);
        }
        self.config.disable_worktree(chat_id).await
    }

    /// Fork the chat's history into a fresh worktree-backed chat. The lifecycle
    /// creates the new (active) chat; the config manager then enables the worktree
    /// on it — mirrors the TS `forkToWorktree(..., enableWorktreeFn)` callback.
    pub async fn fork_to_worktree(
        &self,
        chat_id: &str,
        base_branch: &str,
        branch_name: &str,
    ) -> Result<String, ForkError> {
        let new_chat_id = self
            .lifecycle
            .fork_to_worktree(chat_id, base_branch, branch_name)
            .await?;
        self.config
            .enable_worktree(&new_chat_id, base_branch, branch_name)
            .await?;
        Ok(new_chat_id)
    }

    /// Remove a project and all its chats' live resources.
    pub async fn remove_project(&self, project_id: &str) -> Result<(), String> {
        let chats = self.deps.chats_list(project_id);
        for chat in chats {
            let cell = self.get_active(&chat.id);
            let session = cell
                .as_ref()
                .and_then(|c| c.lock().unwrap_or_else(|e| e.into_inner()).session.clone());
            self.deps
                .kill_tasks_for_chat(&chat.id, chat.worktree_path.clone(), session.clone())
                .await;
            if let Some(session) = &session
                && let Err(err) = session.kill().await
            {
                tracing::warn!(
                    ?err,
                    chat_id = chat.id,
                    "session.kill failed on project removal"
                );
            }
            self.active_chats.remove(&chat.id);
            self.messages
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .delete(&chat.id);
            self.permissions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .forget(&chat.id);
            self.deps.tracker_remove_chat(&chat.id);
            self.event_handler.clear_display_cache(&chat.id);
        }
        self.deps.projects_remove(project_id)?;
        info!(project_id, "project removed");
        Ok(())
    }
}
