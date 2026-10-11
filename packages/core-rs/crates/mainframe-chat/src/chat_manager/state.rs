use super::*;
use crate::orchestration_hooks::OrchestrationSlot;
use mainframe_types::sync::LockExt as _;

pub(crate) struct ChatShared {
    pub(crate) deps: Arc<dyn ChatManagerDeps>,
    pub(crate) active_chats: Registry,
    pub(crate) messages: Arc<Mutex<MessageCache>>,
    pub(crate) permissions: Arc<Mutex<PermissionManager>>,
    pub(crate) queued_refs: QueuedRefs,
    pub(crate) orchestration: OrchestrationSlot,
}

impl ChatShared {
    pub(crate) fn new(deps: Arc<dyn ChatManagerDeps>) -> Arc<Self> {
        Self::with_messages(deps, Arc::new(Mutex::new(MessageCache::new())))
    }

    /// `new`, over a caller-built message cache (a test's clocked cache).
    pub(crate) fn with_messages(
        deps: Arc<dyn ChatManagerDeps>,
        messages: Arc<Mutex<MessageCache>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            deps,
            active_chats: Arc::new(DashMap::new()),
            messages,
            permissions: Arc::new(Mutex::new(PermissionManager::new())),
            queued_refs: Arc::new(Mutex::new(Vec::new())),
            orchestration: OrchestrationSlot::default(),
        })
    }

    // ── queued-ref helpers ───────────────────────────────────────────────────

    /// The chat's queued refs, oldest-first (enqueue order): `queue_state`
    /// snapshots render in this order, so it is part of the wire contract.
    pub(crate) fn queued_for_chat(&self, chat_id: &str) -> Vec<QueuedMessageRef> {
        self.queued_refs
            .lock_recover()
            .iter()
            .filter(|r| r.chat_id == chat_id)
            .cloned()
            .collect()
    }

    pub(crate) fn handle_queued_processed(&self, chat_id: &str, uuid: &str) {
        let removed = {
            let mut guard = self.queued_refs.lock_recover();
            guard
                .iter()
                .position(|r| r.uuid == uuid)
                .map(|i| guard.remove(i))
        };
        if let Some(r) = removed {
            info!(
                chat_id,
                uuid,
                message_id = r.message_id,
                "CLI processed queued message"
            );
        }
    }

    pub(crate) fn clear_all_queued_for_chat(&self, chat_id: &str) {
        let mut guard = self.queued_refs.lock_recover();
        let before = guard.len();
        guard.retain(|r| r.chat_id != chat_id);
        let removed = before - guard.len();
        drop(guard);
        if removed > 0 {
            info!(chat_id, removed, "cleared queued refs for exited chat");
        }
    }

    /// The live registry cell for `chat_id`, if the chat is active.
    pub(crate) fn active(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        self.active_chats.get(chat_id).map(|e| e.value().clone())
    }

    /// The chat as the live cell knows it, else as the store has it.
    pub(crate) fn chat_or_db(&self, chat_id: &str) -> Option<Chat> {
        self.active(chat_id)
            .map(|c| c.lock_recover().chat.clone())
            .or_else(|| storage_event!(self, self.deps.chats_get(chat_id), None))
    }
}

impl ChatShared {
    pub(crate) fn update_and_emit(
        &self,
        chat: Chat,
        patch: &ChatPatch,
    ) -> Result<(), mainframe_types::seam_error::SeamError> {
        self.deps.chats_update(&chat.id, patch)?;
        self.emit(DaemonEvent::ChatUpdated { chat, reason: None });
        Ok(())
    }
}

impl ChatShared {
    pub(crate) fn report_storage_error(&self, error: &mainframe_types::seam_error::SeamError) {
        tracing::error!(%error, "chat storage operation failed");
        self.emit(DaemonEvent::Error {
            chat_id: None,
            error: error.to_string(),
        });
    }
}
