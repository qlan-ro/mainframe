use super::*;

impl ChatConfigManager {
    pub async fn attach_worktree(
        &self,
        chat_id: &str,
        worktree_path: &str,
        branch_name: Option<&str>,
    ) -> Result<(), ConfigError> {
        let cell = self.require_active_chat(chat_id)?;
        let (current_worktree, project_id, claude_session_id, adapter) = {
            let guard = cell.lock_recover();
            (
                guard.chat.worktree_path.clone(),
                guard.chat.project_id.clone(),
                guard.chat.claude_session_id.clone(),
                guard.chat.adapter_id.clone(),
            )
        };
        if current_worktree.as_deref() == Some(worktree_path) {
            return Ok(());
        }
        let branch_name = branch_name.map(str::to_string);

        if let Some(session_id) = claude_session_id {
            let project = self
                .shared
                .deps
                .projects_get_path(&project_id)
                .ok_or_else(|| NotFound::unnamed("Project"))?;
            return self
                .rebind_live_session(
                    &cell,
                    chat_id,
                    LiveRebind {
                        project_id: &project_id,
                        old_dir: effective_dir(current_worktree.as_deref(), &project),
                        old_worktree: current_worktree.as_deref(),
                        active: ActiveSession {
                            adapter_id: &adapter,
                            session_id: Some(&session_id),
                        },
                        worktree_path: worktree_path.to_string(),
                        branch_name,
                    },
                )
                .await;
        }

        // Pre-session path
        self.detach_session(&cell).await?;
        self.apply_worktree_update(
            &cell,
            chat_id,
            Some(worktree_path.to_string()),
            branch_name,
            None,
        );
        Ok(())
    }

    pub async fn disable_worktree(&self, chat_id: &str) -> Result<(), ConfigError> {
        let Some(cell) = self.active_chat(chat_id) else {
            return Ok(());
        };
        let (worktree_path, has_claude_session, project_id, branch_name) = {
            let guard = cell.lock_recover();
            (
                guard.chat.worktree_path.clone(),
                guard.chat.claude_session_id.is_some(),
                guard.chat.project_id.clone(),
                guard.chat.branch_name.clone(),
            )
        };
        let Some(worktree_path) = worktree_path else {
            return Ok(());
        };
        if has_claude_session
            || self
                .shared
                .deps
                .segment_store()
                .is_some_and(|s| s.has_native_id(chat_id))
        {
            return Err(ConfigError::Refused(
                "Cannot disable worktree after session has started".to_string(),
            ));
        }

        self.detach_session(&cell).await?;

        if let Some(fut) = self
            .shared
            .deps
            .stop_launch_processes(&project_id, &worktree_path)
        {
            fut.await;
        }

        if let Some(project) = self.shared.deps.projects_get_path(&project_id) {
            remove_worktree(
                &project,
                &worktree_path,
                branch_name.as_deref().unwrap_or_default(),
            )
            .await;
        }

        self.apply_worktree_update(&cell, chat_id, None, None, None);
        Ok(())
    }
}
