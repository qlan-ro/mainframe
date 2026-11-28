//! Idle history release: a live chat nobody is viewing, with no CLI or other
//! process alive, gives up its history and projection while its registry cell,
//! pin and tool timings stay. The chat is marked released until a full history
//! is stored for it again (`set`, a restore), or until it leaves the cache
//! altogether (`delete`, `unpin`).
//!
//! A released chat has no producer of output: the release skips any chat with
//! a live process, and every path that starts one, or appends for the user (a
//! send, a steer, a resume), restores the history first
//! (`ChatLifecycleManager::restore_released_history`). So does every path
//! that writes a daemon-only entry (a permission answer, a notice): those
//! cannot be read back from the transcript. An append that still reaches a
//! released chat is a bug; it is skipped and logged as an error, never stored
//! as a partial list.
//!
//! Two counters keep the boundary honest:
//! - the history epoch advances with every write, so a history read that began
//!   before another write never installs its older list over it
//!   (`install_history`);
//! - the activity generation advances with every use of the chat, so the
//!   release clears nothing when the chat was used or viewed after the release
//!   decided it was idle (`release_history_if_unused`).

use super::*;

#[derive(Default)]
pub(crate) struct ReleaseState {
    released: HashSet<String>,
    /// Per-chat history epochs (`MessageCache::history_epoch`).
    epochs: HashMap<String, u64>,
    /// Per-chat activity generations (`MessageCache::activity`).
    activity: HashMap<String, u64>,
    /// Chats whose composed history was installed with a segment missing.
    partial: HashSet<String>,
}

impl MessageCache {
    /// Drop `chat_id`'s raw history and projection and mark it released.
    /// Returns false, changing nothing, when it holds no history.
    pub(crate) fn release_history(&mut self, chat_id: &str) -> bool {
        if self.cache.remove(chat_id).is_none() {
            return false;
        }
        self.order.retain(|k| k != chat_id);
        self.drop_projection(chat_id);
        self.released.released.insert(chat_id.to_owned());
        true
    }

    /// [`Self::release_history`], unless the chat was used since its activity
    /// generation read `seen`. Checked and cleared under the one cache lock
    /// that every use takes to advance the generation.
    pub(crate) fn release_history_if_unused(&mut self, chat_id: &str, seen: u64) -> bool {
        if self.activity(chat_id) != seen {
            tracing::debug!(chat_id, "kept a history used during the release");
            return false;
        }
        self.release_history(chat_id)
    }

    /// Whether the idle release dropped this chat's history and nothing has
    /// restored it since.
    pub(crate) fn is_released(&self, chat_id: &str) -> bool {
        self.released.released.contains(chat_id)
    }

    pub(super) fn forget_release(&mut self, chat_id: &str) {
        self.released.released.remove(chat_id);
    }

    /// Record whether the history being installed for `chat_id` misses a
    /// transcript that failed to load. Such a history cannot be read back
    /// whole, so the release keeps it (`is_partial`).
    pub(crate) fn mark_partial(&mut self, chat_id: &str, partial: bool) {
        if partial {
            self.released.partial.insert(chat_id.to_owned());
        } else {
            self.released.partial.remove(chat_id);
        }
    }

    pub(crate) fn is_partial(&self, chat_id: &str) -> bool {
        self.released.partial.contains(chat_id)
    }

    /// True when an append to `chat_id` must be skipped (see the module doc).
    pub(super) fn skips_released_append(&self, chat_id: &str) -> bool {
        let skip = self.is_released(chat_id);
        if skip {
            tracing::error!(chat_id, "skipped an append to a released history");
        }
        skip
    }

    /// Advances with every mutation of the chat's history, whether or not the
    /// chat holds one; never moves backwards.
    pub(crate) fn history_epoch(&self, chat_id: &str) -> u64 {
        self.released.epochs.get(chat_id).copied().unwrap_or(0)
    }

    pub(crate) fn advance_epoch(&mut self, chat_id: &str) {
        self.released
            .epochs
            .insert(chat_id.to_owned(), self.next_generation);
    }

    /// Advances with every use of the chat (`ChatLifecycleManager::touch`).
    pub(crate) fn activity(&self, chat_id: &str) -> u64 {
        self.released.activity.get(chat_id).copied().unwrap_or(0)
    }

    pub(crate) fn note_activity(&mut self, chat_id: &str) {
        *self
            .released
            .activity
            .entry(chat_id.to_owned())
            .or_default() += 1;
    }

    /// Store `messages` as the chat's history unless something changed it
    /// since `read_from` (its epoch when the read began): a send that
    /// restored and appended meanwhile must not be overwritten by an older
    /// list. `None` when the history moved on.
    pub(crate) fn install_history(
        &mut self,
        chat_id: &str,
        read_from: u64,
        messages: Vec<ChatMessage>,
    ) -> Option<Vec<ChatMessage>> {
        if self.history_epoch(chat_id) != read_from {
            tracing::debug!(chat_id, "kept a history written during the read");
            return None;
        }
        Some(self.set_and_snapshot(chat_id, messages))
    }
}

#[cfg(test)]
#[path = "release_tests.rs"]
mod tests;
