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
    /// appends to it; a no-op for any other chat. `load_chat` claims the
    /// restore, so concurrent callers share one read.
    pub(crate) async fn restore_released_history(&self, chat_id: &str) {
        if self.history_released(chat_id) {
            self.load_chat(chat_id).await;
        }
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
