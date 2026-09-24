//! Temporary-chat discard (#346 rule 5) and the per-chat live-state teardown
//! it shares with `config_api.rs::remove_project`.
use super::*;

impl ChatManager {
    /// The per-chat teardown `remove_project` runs for every chat in a removed
    /// project, extracted so `discard_chat` reuses the exact same steps: kill
    /// tasks, kill the session, drop the active entry, drop the message cache,
    /// forget permissions (which drops a pending gate), remove it from the
    /// tracker, clear display state, and notify the chat-surface `ChatEnded`.
    pub(super) async fn teardown_live_chat(&self, chat: &Chat) {
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
                "session.kill failed during teardown"
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
        self.event_handler.clear_display_state(&chat.id);
        self.event_handler
            .notify_chat_surface(crate::chat_surface::ChatSurfaceEvent::ChatEnded {
                chat_id: chat.id.clone(),
            });
    }

    /// Rule 5: discard a temporary chat. The route owns the 404 (unknown chat)
    /// and `fail` (non-temporary chat) responses; this assumes the caller
    /// already resolved and validated the chat.
    pub async fn discard_chat(&self, chat_id: &str) -> Result<(), String> {
        let Some(chat) = self.deps.chats_get(chat_id) else {
            return Err("Chat not found".to_string());
        };

        self.teardown_live_chat(&chat).await;
        self.deps.attachment_delete_chat(chat_id).await;
        if let Some(scratch_path) = &chat.scratch_path {
            // NotFound counts as success (already gone); any other error stops
            // here so the row is not deleted and a retry stays possible.
            self.deps.remove_scratch_dir(scratch_path).await?;
        }
        self.deps.chats_delete(chat_id);
        self.deps.emit_event(DaemonEvent::ChatEnded {
            chat_id: chat_id.to_string(),
        });
        Ok(())
    }
}
