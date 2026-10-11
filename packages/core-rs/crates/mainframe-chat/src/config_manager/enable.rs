use super::*;

impl ChatConfigManager {
    pub(super) async fn worktree_dir(&self) -> String {
        read_setting(self.shared.deps.settings(), "general", "worktreeDir")
            .await
            .unwrap_or_else(|| GeneralConfig::default().worktree_dir)
    }

    pub async fn enable_worktree(
        &self,
        chat_id: &str,
        base_branch: &str,
        branch_name: &str,
    ) -> Result<(), ConfigError> {
        let cell = self.require_active_chat(chat_id)?;
        let (has_worktree, project_id, claude_session_id, adapter) = {
            let guard = cell.lock_recover();
            (
                guard.chat.worktree_path.is_some(),
                guard.chat.project_id.clone(),
                guard.chat.claude_session_id.clone(),
                guard.chat.adapter_id.clone(),
            )
        };
        if has_worktree {
            return Ok(());
        }

        let project = self
            .shared
            .deps
            .projects_get_path(&project_id)
            .ok_or_else(|| NotFound::unnamed("Project"))?;

        if let Some(session_id) = claude_session_id {
            // Mid-session path. The worktree is created while the chat still runs,
            // so a failed `git worktree add` leaves it untouched.
            let info = create_worktree(
                &project,
                &self.worktree_dir().await,
                base_branch,
                branch_name,
            )
            .await?;
            return self
                .rebind_live_session(
                    &cell,
                    chat_id,
                    LiveRebind {
                        project_id: &project_id,
                        old_dir: &project,
                        old_worktree: None,
                        active: ActiveSession {
                            adapter_id: &adapter,
                            session_id: Some(&session_id),
                        },
                        worktree_path: info.worktree_path.clone(),
                        branch_name: Some(info.branch_name),
                    },
                )
                .await
                .map_err(|err| match err {
                    ConfigError::TranscriptMoveFailed(source) => ConfigError::WorktreeCreated {
                        worktree_path: info.worktree_path,
                        source,
                    },
                    ConfigError::Store(source) => ConfigError::WorktreeCreated {
                        worktree_path: info.worktree_path,
                        source: RelocateError::Store(source),
                    },
                    other => other,
                });
        }

        // Pre-session path: kill any untracked process and create worktree
        self.detach_session(&cell).await?;

        let info = create_worktree(
            &project,
            &self.worktree_dir().await,
            base_branch,
            branch_name,
        )
        .await?;
        // A switched chat whose new segment hasn't sent yet still owns its
        // earlier sessions; returning to one resumes it from the worktree.
        let active = ActiveSession {
            adapter_id: &adapter,
            session_id: None,
        };
        relocate_claude_transcripts(
            self.shared.deps.as_ref(),
            chat_id,
            active,
            &project,
            &info.worktree_path,
        )
        .await
        .map_err(|err| {
            tracing::error!(
                chat_id,
                worktree_path = %info.worktree_path,
                error = %err,
                "failed to move session files into the new worktree"
            );
            ConfigError::WorktreeCreated {
                worktree_path: info.worktree_path.clone(),
                source: err,
            }
        })?;
        self.apply_worktree_update(
            &cell,
            chat_id,
            Some(info.worktree_path),
            Some(info.branch_name),
            None,
        )?;
        Ok(())
    }
}
