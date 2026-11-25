//! Per-chat flags that last until the chat's turn state changes: a Stop under
//! way, and messages waiting for the next turn.

use std::collections::HashSet;

use mainframe_types::sync::LockExt as _;

use crate::service::OrchestrationService;

/// Why a chat's messages wait for its next turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Hold {
    /// They survived a restart.
    Boot,
    /// The last delivery failed.
    DeliveryFailed,
}

impl OrchestrationService {
    /// Stop step 1: end the chat's in-flight calls and refuse late mutating
    /// calls from the stopped turn until the chat goes idle.
    pub(crate) async fn begin_stop(&self, chat_id: &str) {
        self.mark_stopping(chat_id);
        // No event follows a Stop that had no turn to end, and a flag left
        // behind would refuse every call of the chat's next turn. Read after
        // marking: a turn that ends in between clears the flag either way.
        self.settle_turn(chat_id).await;
    }

    pub(crate) fn mark_stopping(&self, chat_id: &str) {
        self.credentials().cancel_inflight(chat_id);
        self.stopping.lock_recover().insert(chat_id.to_string());
    }

    pub(crate) fn is_stopping(&self, chat_id: &str) -> bool {
        self.stopping.lock_recover().contains(chat_id)
    }

    /// Keeps `chat_id`'s messages until it spawns or runs a turn.
    pub(crate) fn hold(&self, chat_id: &str, reason: Hold) {
        self.held.lock_recover().insert(chat_id.to_string(), reason);
    }

    /// A new message for `chat_id` is worth one more try at a delivery that
    /// failed; a parent the restart holds is left alone.
    pub(crate) fn retry_failed_delivery(&self, chat_id: &str) {
        self.held
            .lock_recover()
            .retain(|id, hold| id != chat_id || *hold != Hold::DeliveryFailed);
    }

    pub(crate) fn is_held(&self, chat_id: &str) -> bool {
        self.held.lock_recover().contains_key(chat_id)
    }

    pub(crate) fn release(&self, chat_id: &str) {
        self.held.lock_recover().remove(chat_id);
    }

    /// Drops the flags `chat_id`'s turn state has outdated: a Stop is over
    /// once the chat is idle, a hold once it runs a turn, and both once the
    /// chat is gone (a discard deletes the row before it emits `ChatEnded`).
    /// Most chats have neither flag and skip the port.
    pub(crate) async fn settle_turn(&self, chat_id: &str) {
        let (stopping, held) = (self.is_stopping(chat_id), self.is_held(chat_id));
        if !stopping && !held {
            return;
        }
        let working = match self.port.chat(chat_id).await {
            Ok(chat) => chat.map(|c| c.working),
            Err(err) => {
                tracing::warn!(chat_id, error = %err, "failed to read a chat's turn state");
                return;
            }
        };
        if stopping && working != Some(true) {
            self.stopping.lock_recover().remove(chat_id);
        }
        if held && working != Some(false) {
            self.release(chat_id);
        }
    }

    /// Every chat [`Self::settle_turn`] may have something to drop for.
    pub(crate) fn unsettled(&self) -> HashSet<String> {
        let mut unsettled = self.stopping.lock_recover().clone();
        unsettled.extend(self.held.lock_recover().keys().cloned());
        unsettled
    }
}
