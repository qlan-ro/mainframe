//! Idle history release: a live chat nobody is viewing gives up its history and
//! projection while its registry cell, pin and tool timings stay. The chat is
//! marked released until a full history is stored for it again (`set`, a
//! restore), or until it leaves the cache altogether (`delete`, `unpin`).
//!
//! A released chat never holds a partial list. Output that reaches it before
//! the restore (a turn the CLI started by itself, a daemon notice) is buffered,
//! and the restore adopts the buffer: an entry the transcript already holds
//! under the same id is dropped, anything else (output not yet on disk, notices
//! the transcript never had) follows the restored history in arrival order.
//! Right after that, a live append whose id the restored history already holds
//! is the same record arriving late and is dropped too; the first new id ends
//! that check.
//!
//! Every mutation also advances the chat's history epoch, so a history read
//! that started before another write can tell and does not install its older
//! list over it (`install_history`).

use super::*;

/// How far back from the end a late live append is looked for.
const RECONCILE_WINDOW: usize = 256;

#[derive(Default)]
pub(crate) struct ReleaseState {
    /// Released chats, each with what arrived since its release.
    buffers: HashMap<String, Vec<ChatMessage>>,
    /// Chats whose restored history may still meet late live appends.
    reconciling: HashSet<String>,
    /// Per-chat history epochs (`MessageCache::history_epoch`).
    epochs: HashMap<String, u64>,
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
        self.released.reconciling.remove(chat_id);
        self.released.buffers.insert(chat_id.to_owned(), Vec::new());
        true
    }

    /// Whether the idle release dropped this chat's history and nothing has
    /// restored it since.
    pub(crate) fn is_released(&self, chat_id: &str) -> bool {
        self.released.buffers.contains_key(chat_id)
    }

    pub(super) fn forget_release(&mut self, chat_id: &str) {
        self.released.buffers.remove(chat_id);
        self.released.reconciling.remove(chat_id);
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

    /// Fold what arrived while the chat was released into the history being
    /// restored for it (see the module doc). A no-op for any other chat.
    pub(super) fn adopt_released(
        &mut self,
        chat_id: &str,
        mut messages: Vec<ChatMessage>,
    ) -> Vec<ChatMessage> {
        let Some(buffered) = self.released.buffers.remove(chat_id) else {
            return messages;
        };
        for message in buffered {
            if !messages.iter().any(|m| m.id == message.id) {
                messages.push(message);
            }
        }
        self.released.reconciling.insert(chat_id.to_owned());
        messages
    }

    /// Route an append around a release: `None` when it was buffered (the
    /// chat is released) or is a late copy of a restored record; otherwise
    /// the message, to append as usual.
    pub(super) fn intercept_append(
        &mut self,
        chat_id: &str,
        message: ChatMessage,
    ) -> Option<ChatMessage> {
        if let Some(buffer) = self.released.buffers.get_mut(chat_id) {
            match buffer.iter_mut().find(|m| m.id == message.id) {
                Some(slot) => *slot = message,
                None => buffer.push(message),
            }
            return None;
        }
        if self.released.reconciling.contains(chat_id) {
            let restored = self.cache.get(chat_id).is_some_and(|history| {
                history
                    .iter()
                    .rev()
                    .take(RECONCILE_WINDOW)
                    .any(|m| m.id == message.id)
            });
            if restored {
                tracing::debug!(chat_id, "dropped a live copy of a restored record");
                return None;
            }
            self.released.reconciling.remove(chat_id);
        }
        Some(message)
    }

    /// Nested blocks for a released chat land in their buffered parent. A
    /// parent that is already on disk comes back with the transcript, as on
    /// any cold load. True when the blocks were buffered.
    pub(super) fn buffer_nested(
        &mut self,
        chat_id: &str,
        parent: &str,
        blocks: &mut Vec<MessageContent>,
    ) -> bool {
        let Some(buffer) = self.released.buffers.get_mut(chat_id) else {
            return false;
        };
        let parent = buffer.iter_mut().rev().find(|m| {
            m.r#type == ChatMessageType::Assistant
                && m.content.iter().any(|b| {
                    matches!(b, MessageContent::Node(mainframe_types::chat::MessageContentNode::ToolUse { id, .. }) if id == parent)
                })
        });
        match parent {
            Some(message) => {
                message.content.append(blocks);
                true
            }
            None => false,
        }
    }
}

#[cfg(test)]
#[path = "release_tests.rs"]
mod tests;
