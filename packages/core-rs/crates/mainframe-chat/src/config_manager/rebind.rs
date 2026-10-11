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

        // Same blast radius as `disable_worktree`: the whole (project, path)
        // launch manager, not just this chat's processes.
        if let Some(old) = rebind.old_worktree
            && let Some(fut) = self
                .shared
                .deps
                .stop_launch_processes(rebind.project_id, old)
        {
            fut.await;
        }

        let moved_transcript = match relocate_claude_transcripts(
            self.shared.deps.as_ref(),
            chat_id,
            rebind.active,
            rebind.old_dir,
            &rebind.worktree_path,
        )
        .await
        {
            Ok(path) => path,
            Err(err) => {
                tracing::error!(
                    chat_id,
                    worktree_path = %rebind.worktree_path,
                    error = %err,
                    "failed to move session files; restarting the chat on its current binding"
                );
                self.lifecycle.start_chat(chat_id).await;
                return Err(ConfigError::TranscriptMoveFailed(err));
            }
        };

        let result = self.apply_worktree_update(
            cell,
            chat_id,
            Some(rebind.worktree_path),
            rebind.branch_name,
            moved_transcript,
        );
        self.lifecycle.start_chat(chat_id).await;
        result
    }
}
