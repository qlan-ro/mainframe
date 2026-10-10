//! The single owner of per-chat in-memory teardown.
//!
//! Discard, archive, end and idle offload all drop a chat's live state, but each
//! keeps a different slice of it. Keeping those differences in one table stops
//! the paths from drifting apart: before this module a discarded chat kept its
//! pending worktree offers because only archive and end forgot them.
//!
//! Queued message refs are not cleared here. Killing the session, which every
//! caller does first, runs the sink's exit handler, and that handler clears them.

use std::sync::{Arc, Mutex};

use crate::event_handler::{EventHandler, EventHandlerDeps};
use crate::idle_scanner::ActiveChatRegistry;
use crate::message_cache::MessageCache;
use crate::permission_manager::PermissionManager;
use crate::worktree_offer::WorktreeOfferRegistry;

/// Which teardown is running. Every mode drops the active cell and the display
/// overlays; the rest differs by how much of the chat outlives the call:
///
/// | state            | Discard | Archive | End    | Offload |
/// |------------------|---------|---------|--------|---------|
/// | message cache    | release | release | unpin  | release |
/// | permission state | forget  | clear   | keep   | forget  |
/// | worktree offers  | forget  | forget  | forget | keep    |
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TeardownMode {
    /// The chat row is deleted (temporary-chat discard, project removal), so
    /// nothing about it is worth keeping, cancelled-prompt tombstones included.
    Discard,
    /// The chat can be unarchived, so permission state is cleared but its
    /// cancelled-prompt tombstones survive to drop a late answer.
    Archive,
    /// An ended chat stays readable: its cached messages are only unpinned so
    /// they become evictable, and its permission state is left as it was.
    End,
    /// The chat is still the user's live chat and reloads on next use, so its
    /// worktree offers survive. Offload runs only when no prompt is pending.
    Offload,
}

pub(crate) struct ChatTeardown<E: EventHandlerDeps + 'static> {
    pub active_chats: ActiveChatRegistry,
    pub messages: Arc<Mutex<MessageCache>>,
    pub permissions: Arc<Mutex<PermissionManager>>,
    pub worktree_offers: Arc<WorktreeOfferRegistry>,
    pub event_handler: Arc<EventHandler<E>>,
}

impl<E: EventHandlerDeps + 'static> ChatTeardown<E> {
    pub fn clear(&self, chat_id: &str, mode: TeardownMode) {
        self.active_chats.remove(chat_id);
        {
            let mut messages = self.messages.lock().unwrap_or_else(|e| e.into_inner());
            match mode {
                TeardownMode::End => messages.unpin(chat_id),
                TeardownMode::Discard | TeardownMode::Archive | TeardownMode::Offload => {
                    messages.release(chat_id)
                }
            }
        }
        {
            let mut permissions = self.permissions.lock().unwrap_or_else(|e| e.into_inner());
            match mode {
                TeardownMode::Discard | TeardownMode::Offload => permissions.forget(chat_id),
                TeardownMode::Archive => permissions.clear(chat_id),
                TeardownMode::End => {}
            }
        }
        if mode != TeardownMode::Offload {
            self.worktree_offers.forget(chat_id);
        }
        self.event_handler.clear_display_state(chat_id);
    }
}
