use super::*;

impl<D: ConfigManagerDeps> ChatConfigManager<D> {
    pub(super) fn apply_worktree_update(
        &self,
        cell: &Arc<Mutex<ActiveChat>>,
        chat_id: &str,
        worktree_path: Option<String>,
        branch_name: Option<String>,
        session_file_path: Option<String>,
    ) {
        {
            let mut guard = cell.lock_recover();
            guard.chat.worktree_path = worktree_path.clone();
            guard.chat.branch_name = branch_name.clone();
            if session_file_path.is_some() {
                guard.chat.session_file_path = session_file_path.clone();
            }
        }
        self.deps.chats_update(
            chat_id,
            &ChatPatch {
                worktree_path: Some(worktree_path.clone()),
                branch_name: Some(branch_name),
                session_file_path,
                ..Default::default()
            },
        );
        let chat = cell.lock_recover().chat.clone();
        self.deps
            .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
        self.deps
            .on_binding_changed(chat_id, worktree_path.as_deref());
    }

    pub(super) async fn rebind_live_session(
        &self,
        cell: &Arc<Mutex<ActiveChat>>,
        chat_id: &str,
        rebind: LiveRebind<'_>,
    ) -> Result<(), ConfigError> {
        self.deps.stop_chat(chat_id).await;

        // Same blast radius as `disable_worktree`: the whole (project, path)
        // launch manager, not just this chat's processes.
        if let Some(old) = rebind.old_worktree
            && let Some(fut) = self.deps.stop_launch_processes(rebind.project_id, old)
        {
            fut.await;
        }

        let moved_transcript = match relocate_claude_transcripts(
            &self.deps,
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
                self.deps.start_chat(chat_id).await;
                return Err(ConfigError::TranscriptMoveFailed(err));
            }
        };

        self.apply_worktree_update(
            cell,
            chat_id,
            Some(rebind.worktree_path),
            rebind.branch_name,
            moved_transcript,
        );
        self.deps.start_chat(chat_id).await;
        Ok(())
    }
}
