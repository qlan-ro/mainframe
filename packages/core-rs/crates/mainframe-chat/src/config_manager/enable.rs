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
        self.enable_worktree_from(
            chat_id,
            branch_name,
            WorktreeSource::NewBranch { base_branch },
        )
        .await
    }

    /// `enable_worktree` for a caller that reuses one branch across runs (an
    /// automation's fixed worktree branch): bind to the worktree that already
    /// has the branch checked out, else check the existing branch out into a
    /// new worktree, else create the branch from `base_branch`.
    pub async fn enable_or_reuse_worktree(
        &self,
        chat_id: &str,
        base_branch: &str,
        branch_name: &str,
    ) -> Result<(), ConfigError> {
        let project_id = self
            .require_active_chat(chat_id)?
            .lock_recover()
            .chat
            .project_id
            .clone();
        let project = self
            .shared
            .deps
            .projects_get_path(&project_id)
            .ok_or_else(|| NotFound::unnamed("Project"))?;
        if let Some(worktree_path) = find_branch_worktree(&project, branch_name).await {
            return self
                .attach_worktree(chat_id, &worktree_path, Some(branch_name))
                .await;
        }
        let source = if branch_exists(&project, branch_name).await {
            WorktreeSource::ExistingBranch
        } else {
            WorktreeSource::NewBranch { base_branch }
        };
        self.enable_worktree_from(chat_id, branch_name, source)
            .await
    }

    async fn enable_worktree_from(
        &self,
        chat_id: &str,
        branch_name: &str,
        source: WorktreeSource<'_>,
    ) -> Result<(), ConfigError> {
        let cell = self.require_active_chat(chat_id)?;
        let chat = cell.lock_recover().chat.clone();
        if chat.worktree_path.is_some() {
            return Ok(());
        }
        let project_id = chat.project_id;
        let adapter = chat.adapter_id;
        let vendor_session_id = chat.vendor_session_id;

        let project = self
            .shared
            .deps
            .projects_get_path(&project_id)
            .ok_or_else(|| NotFound::unnamed("Project"))?;

        if let Some(session_id) = vendor_session_id {
            // Mid-session path. The worktree is created while the chat still runs,
            // so a failed `git worktree add` leaves it untouched.
            let info = self
                .create_chat_worktree(&project, branch_name, source)
                .await?;
            return self
                .enable_live_worktree(
                    &cell,
                    chat_id,
                    &project_id,
                    &project,
                    ActiveSession {
                        adapter_id: &adapter,
                        session_id: Some(&session_id),
                    },
                    info,
                )
                .await;
        }

        // Pre-session path: kill any untracked process and create worktree
        self.detach_session(&cell).await?;

        let info = self
            .create_chat_worktree(&project, branch_name, source)
            .await?;
        self.relocate_new_worktree(chat_id, &adapter, &project, &info.worktree_path)
            .await?;
        self.apply_worktree_update(
            &cell,
            chat_id,
            Some(info.worktree_path),
            Some(info.branch_name),
            None,
        )?;
        Ok(())
    }
    async fn enable_live_worktree(
        &self,
        cell: &Arc<Mutex<ActiveChat>>,
        chat_id: &str,
        project_id: &str,
        project: &str,
        active: ActiveSession<'_>,
        info: mainframe_services::workspace::worktree::WorktreeInfo,
    ) -> Result<(), ConfigError> {
        self.rebind_live_session(
            cell,
            chat_id,
            LiveRebind {
                project_id,
                old_dir: project,
                old_worktree: None,
                active,
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
        })
    }

    async fn relocate_new_worktree(
        &self,
        chat_id: &str,
        adapter: &str,
        project: &str,
        worktree_path: &str,
    ) -> Result<(), ConfigError> {
        // A switched chat whose new segment hasn't sent yet still owns its
        // earlier sessions; returning to one resumes it from the worktree.
        let active = ActiveSession {
            adapter_id: adapter,
            session_id: None,
        };
        relocate_transcripts(
            self.shared.deps.as_ref(),
            chat_id,
            active,
            project,
            worktree_path,
        )
        .await
        .map_err(|err| {
            tracing::error!(
                chat_id,
                worktree_path,
                error = %err,
                "failed to move session files into the new worktree"
            );
            ConfigError::WorktreeCreated {
                worktree_path: worktree_path.to_string(),
                source: err,
            }
        })?;
        Ok(())
    }
    async fn create_chat_worktree(
        &self,
        project: &str,
        branch_name: &str,
        source: WorktreeSource<'_>,
    ) -> Result<mainframe_services::workspace::worktree::WorktreeInfo, WorktreeError> {
        let dir_name = self.worktree_dir().await;
        match source {
            WorktreeSource::NewBranch { base_branch } => {
                create_worktree(project, &dir_name, base_branch, branch_name).await
            }
            WorktreeSource::ExistingBranch => {
                checkout_worktree(project, &dir_name, branch_name).await
            }
        }
    }
}

/// Where a newly created worktree's branch comes from.
#[derive(Clone, Copy)]
enum WorktreeSource<'a> {
    /// Create the branch from `base_branch` (`git worktree add -b`).
    NewBranch { base_branch: &'a str },
    /// Check out a branch that already exists.
    ExistingBranch,
}
