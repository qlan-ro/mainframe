use super::*;

impl ChatConfigManager {
    pub(super) fn apply_worktree_update(
        &self,
        cell: &Arc<Mutex<ActiveChat>>,
        chat_id: &str,
        worktree_path: Option<String>,
        branch_name: Option<String>,
        session_file_path: Option<String>,
    ) -> Result<(), ConfigError> {
        let update = self.shared.prepare_update(
            chat_id,
            &ChatPatch {
                worktree_path: Some(worktree_path.clone()),
                branch_name: Some(branch_name.clone()),
                session_file_path: session_file_path.clone(),
                ..Default::default()
            },
        )?;
        let chat = {
            let mut guard = cell.lock_recover();
            guard.chat.worktree_path = worktree_path.clone();
            guard.chat.branch_name = branch_name;
            if session_file_path.is_some() {
                guard.chat.session_file_path = session_file_path;
            }
            guard.chat.clone()
        };
        update.emit(chat, None);
        self.worktree_offers
            .on_binding_changed(chat_id, worktree_path.as_deref());
        Ok(())
    }

    pub(super) async fn rebind_live_session(
        &self,
        cell: &Arc<Mutex<ActiveChat>>,
        chat_id: &str,
        rebind: LiveRebind<'_>,
    ) -> Result<(), ConfigError> {
        self.lifecycle.stop_chat(chat_id).await;

        let moved_transcript = match self.move_for_rebind(chat_id, &rebind).await {
            Ok(path) => path,
            Err(error) => {
                self.lifecycle.start_chat(chat_id).await;
                return Err(error);
            }
        };

        let result = self.apply_worktree_update(
            cell,
            chat_id,
            Some(rebind.worktree_path.clone()),
            rebind.branch_name.clone(),
            moved_transcript.clone(),
        );
        if result.is_err()
            && let Some(path) = moved_transcript
        {
            self.keep_moved_binding(
                cell,
                chat_id,
                rebind.worktree_path,
                rebind.branch_name,
                path,
            );
        }
        self.lifecycle.start_chat(chat_id).await;
        result
    }

    async fn move_for_rebind(
        &self,
        chat_id: &str,
        rebind: &LiveRebind<'_>,
    ) -> Result<Option<String>, ConfigError> {
        if let Some(old) = rebind.old_worktree
            && let Some(fut) = self
                .shared
                .deps
                .stop_launch_processes(rebind.project_id, old)
        {
            fut.await;
        }
        relocate_claude_transcripts(
            self.shared.deps.as_ref(),
            chat_id,
            ActiveSession {
                adapter_id: rebind.active.adapter_id,
                session_id: rebind.active.session_id,
            },
            rebind.old_dir,
            &rebind.worktree_path,
        )
        .await
        .map_err(|error| {
            tracing::error!(chat_id, worktree_path = %rebind.worktree_path, %error,
                "failed to move session files; restarting the chat on its current binding");
            ConfigError::TranscriptMoveFailed(error)
        })
    }

    fn keep_moved_binding(
        &self,
        cell: &Arc<Mutex<ActiveChat>>,
        chat_id: &str,
        worktree_path: String,
        branch_name: Option<String>,
        session_file_path: String,
    ) {
        let chat = {
            let mut guard = cell.lock_recover();
            guard.chat.worktree_path = Some(worktree_path.clone());
            guard.chat.branch_name = branch_name;
            guard.chat.session_file_path = Some(session_file_path);
            guard.chat.clone()
        };
        self.shared
            .prepare_live_update(
                chat_id,
                &ChatPatch {
                    worktree_path: Some(chat.worktree_path.clone()),
                    branch_name: Some(chat.branch_name.clone()),
                    session_file_path: chat.session_file_path.clone(),
                    ..Default::default()
                },
            )
            .emit(chat, None);
        self.worktree_offers
            .on_binding_changed(chat_id, Some(&worktree_path));
    }
}
