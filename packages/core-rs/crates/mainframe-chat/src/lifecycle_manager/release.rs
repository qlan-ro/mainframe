//! The lifecycle half of the idle history release (`idle_release.rs`): a
//! released chat keeps its cell, so every path that would append to its
//! history restores it first.
use super::*;

impl ChatLifecycleManager {
    /// Whether the chat has a live cell whose history the idle release dropped.
    pub(crate) fn history_released(&self, chat_id: &str) -> bool {
        self.shared.active_chats.contains_key(chat_id)
            && self.shared.messages.lock_recover().is_released(chat_id)
    }

    /// Restore a released chat's history into its live cell before anything
    /// appends to it; `Ok` at once for any other chat. `load_chat` claims the
    /// restore, so concurrent callers share one read. `Err` when the chat is
    /// still released afterwards (its transcript could not be read): the
    /// caller must not append, and a send reports a retryable error.
    pub(crate) async fn restore_released_history(
        &self,
        chat_id: &str,
    ) -> Result<(), HistoryUnavailable> {
        if !self.history_released(chat_id) {
            return Ok(());
        }
        self.load_chat(chat_id).await;
        if self.history_released(chat_id) {
            return Err(HistoryUnavailable);
        }
        Ok(())
    }

    /// Tell the chat surface that the chat's in-memory history is gone, so it
    /// drops what it derived from it (the facade hub's revision log).
    pub(crate) fn notify_history_released(&self, chat_id: &str) {
        chat_surface::notify(
            self.chat_surface.get(),
            ChatSurfaceEvent::HistoryReleased {
                chat_id: chat_id.to_string(),
            },
        );
    }
}

/// A released history could not be restored.
#[derive(Debug, thiserror::Error)]
#[error("This chat's history could not be reloaded. Try again.")]
pub(crate) struct HistoryUnavailable;
