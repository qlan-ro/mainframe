use std::sync::{Arc, Mutex};

use mainframe_types::chat::QueuedMessageRef;

use crate::chat_manager::handoff_locks::HandoffLocks;
use crate::event_handler::{EventHandler, EventHandlerDeps};
use crate::idle_scanner::ActiveChatRegistry;
use crate::message_cache::MessageCache;
use crate::permission_manager::PermissionManager;
use crate::worktree_offer::WorktreeOfferRegistry;

#[derive(Clone, Copy)]
pub(crate) enum TeardownMode {
    Discard,
    Archive,
    End,
    Offload,
}

pub(crate) struct ChatTeardown<E: EventHandlerDeps + 'static> {
    pub active_chats: ActiveChatRegistry,
    pub messages: Arc<Mutex<MessageCache>>,
    pub permissions: Arc<Mutex<PermissionManager>>,
    pub queued_refs: Arc<Mutex<Vec<QueuedMessageRef>>>,
    pub worktree_offers: Arc<WorktreeOfferRegistry>,
    pub event_handler: Arc<EventHandler<E>>,
    pub handoff_locks: Arc<HandoffLocks>,
}

impl<E: EventHandlerDeps + 'static> ChatTeardown<E> {
    pub fn clear(&self, chat_id: &str, mode: TeardownMode) {
        self.active_chats.remove(chat_id);
        {
            let mut messages = self.messages.lock().unwrap_or_else(|e| e.into_inner());
            match mode {
                TeardownMode::End => messages.unpin(chat_id),
                _ => messages.release(chat_id),
            }
        }
        {
            let mut permissions = self.permissions.lock().unwrap_or_else(|e| e.into_inner());
            match mode {
                TeardownMode::Archive | TeardownMode::End => permissions.clear(chat_id),
                TeardownMode::Discard | TeardownMode::Offload => permissions.forget(chat_id),
            }
        }
        self.queued_refs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|queued| queued.chat_id != chat_id);
        self.worktree_offers.forget(chat_id);
        self.event_handler.clear_display_state(chat_id);
        self.handoff_locks.forget(chat_id);
    }
}
