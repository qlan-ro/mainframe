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

    /// The history claim behind `get_messages`' own disk read, decided under
    /// the flight guards: an offload or release in flight is waited out, and a
    /// chat that is released (now, not when the caller last looked) is sent
    /// back to the shared restore instead of a second, unguarded read.
    pub(crate) async fn claim_history_read(&self, chat_id: &str) -> HistoryRead {
        loop {
            let waiting = {
                let guards = self.guards.lock_recover();
                if let Some(wait) = guards
                    .offloading
                    .get(chat_id)
                    .or_else(|| guards.maintenance.get(chat_id))
                {
                    Err(wait)
                } else if self.history_released(chat_id) {
                    return HistoryRead::Released;
                } else {
                    Ok(guards.history.claim(chat_id))
                }
            };
            match waiting {
                Err(wait) => wait.wait().await,
                Ok(Ok(claim)) => return HistoryRead::Lead(claim),
                Ok(Err(wait)) => {
                    wait.wait().await;
                    return HistoryRead::Follower;
                }
            }
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

/// A released history could not be restored.
#[derive(Debug, thiserror::Error)]
#[error("This chat's history could not be reloaded. Try again.")]
pub(crate) struct HistoryUnavailable;

/// How `get_messages` may read a history that is not in memory.
pub(crate) enum HistoryRead {
    /// This caller reads and installs; the claim excludes other readers.
    Lead(FlightClaim),
    /// Another reader just finished: read the cache again.
    Follower,
    /// The chat is released: restore it through the load claim instead.
    Released,
}
