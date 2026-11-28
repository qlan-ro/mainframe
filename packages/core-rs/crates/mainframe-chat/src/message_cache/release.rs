//! Idle history release: a live chat nobody is viewing gives up its history and
//! projection while its registry cell, pin and tool timings stay. The chat is
//! marked released until a full history is stored for it again (`set`, a
//! restore), or until it leaves the cache altogether (`delete`, `unpin`).
//!
//! A released chat never holds a partial list: an append that reaches it before
//! the history is restored is skipped, because the next restore reads the
//! transcript the append came from. The send path restores first
//! (`ChatLifecycleManager::restore_released_history`), so only output the CLI
//! produces on its own lands here.

use super::*;

impl MessageCache {
    /// Drop `chat_id`'s raw history and projection and mark it released.
    /// Returns false, changing nothing, when it holds no history.
    pub(crate) fn release_history(&mut self, chat_id: &str) -> bool {
        if self.cache.remove(chat_id).is_none() {
            return false;
        }
        self.order.retain(|k| k != chat_id);
        self.drop_projection(chat_id);
        self.released.insert(chat_id.to_owned());
        true
    }

    /// Whether the idle release dropped this chat's history and nothing has
    /// restored it since.
    pub(crate) fn is_released(&self, chat_id: &str) -> bool {
        self.released.contains(chat_id)
    }

    pub(super) fn forget_release(&mut self, chat_id: &str) {
        self.released.remove(chat_id);
    }

    /// True when an append to `chat_id` must be skipped (see the module doc).
    pub(super) fn skips_released_append(&self, chat_id: &str) -> bool {
        let skip = self.released.contains(chat_id);
        if skip {
            tracing::debug!(
                chat_id,
                "left an append to a released history to the transcript"
            );
        }
        skip
    }
}

#[cfg(test)]
#[path = "release_tests.rs"]
mod tests;
