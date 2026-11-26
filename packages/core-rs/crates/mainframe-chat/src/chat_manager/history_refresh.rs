//! Turn-end refresh of a chat's persisted history caches.
use super::*;
use crate::history_validation::HistoryValidation;

/// A just-written history snapshot, in the shape the persisted tail needs:
/// the display history a cold restart would render, plus the validation a
/// restart checks before trusting anything built from it.
pub struct RefreshedHistory {
    pub messages: Vec<DisplayMessage>,
    pub validation: HistoryValidation,
}

impl ChatManager {
    /// Reparses an idle chat's transcript from disk and rewrites its history
    /// snapshot, so the next daemon start restores it without a full read.
    /// The in-memory cache is not touched: the result reflects the files, not
    /// the live view. `None` when the chat is busy, not cacheable, or its
    /// files changed during the read.
    pub async fn refresh_history_cache(&self, chat_id: &str) -> Option<RefreshedHistory> {
        if !self.initial_history_eligible(chat_id) {
            return None;
        }
        let chat = self.get_chat(chat_id)?;
        let session = build_history_session(&self.shared.deps, &chat, chat_id)?;
        let (raw, mut validation) = self
            .shared
            .refresh_cached_history(chat_id, session.as_ref())
            .await?;
        let mut restored = PermissionManager::default();
        restored.restore_pending_permission(chat_id, &raw);
        validation.permission_free = !restored.has_pending(chat_id);
        let categories = self.shared.deps.get_tool_categories(chat_id);
        let messages =
            self.shared
                .deps
                .prepare_messages_for_client(chat_id, &raw, categories.as_ref());
        tracing::debug!(chat_id, "refreshed history snapshot");
        Some(RefreshedHistory {
            messages,
            validation,
        })
    }
}
