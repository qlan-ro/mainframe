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
    storage_errors: Mutex<HashMap<String, std::time::Instant>>,
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
            storage_errors: Mutex::new(HashMap::new()),
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
            .or_else(|| storage_event!(self, Some(chat_id); self.deps.chats_get(chat_id), None))
    }
}

impl ChatShared {
    pub(crate) fn update_and_emit(
        &self,
        chat: Chat,
        patch: &ChatPatch,
    ) -> Result<(), mainframe_types::seam_error::SeamError> {
        self.prepare_update(&chat.id, patch)?.emit(chat, None);
        Ok(())
    }
}

#[must_use]
pub(crate) struct PendingChatUpdate<'a> {
    shared: &'a ChatShared,
}

impl PendingChatUpdate<'_> {
    pub(crate) fn emit(
        self,
        chat: Chat,
        reason: Option<mainframe_types::events::ChatUpdatedReason>,
    ) {
        self.shared.emit(DaemonEvent::ChatUpdated { chat, reason });
    }
}

impl ChatShared {
    pub(crate) fn prepare_update(
        &self,
        chat_id: &str,
        patch: &ChatPatch,
    ) -> Result<PendingChatUpdate<'_>, mainframe_types::seam_error::SeamError> {
        self.deps
            .chats_update(chat_id, patch)
            .inspect_err(|error| self.report_storage_error(Some(chat_id), error))?;
        Ok(PendingChatUpdate { shared: self })
    }

    pub(crate) fn best_effort<T>(
        &self,
        chat_id: &str,
        result: Result<T, mainframe_types::seam_error::SeamError>,
        fallback: T,
    ) -> T {
        result.unwrap_or_else(|error| {
            self.report_storage_error(Some(chat_id), &error);
            fallback
        })
    }

    pub(crate) fn prepare_live_update(
        &self,
        chat_id: &str,
        patch: &ChatPatch,
    ) -> PendingChatUpdate<'_> {
        self.best_effort(chat_id, self.deps.chats_update(chat_id, patch), ());
        PendingChatUpdate { shared: self }
    }

    pub(crate) fn report_storage_error(
        &self,
        chat_id: Option<&str>,
        error: &mainframe_types::seam_error::SeamError,
    ) {
        tracing::error!(%error, chat_id, "chat storage operation failed");
        let now = std::time::Instant::now();
        let mut errors = self.storage_errors.lock_recover();
        errors.retain(|_, last| now.duration_since(*last).as_secs() < 10);
        if errors.contains_key(chat_id.unwrap_or_default()) {
            return;
        }
        errors.insert(chat_id.unwrap_or_default().to_owned(), now);
        drop(errors);
        self.emit(DaemonEvent::Error {
            chat_id: chat_id.map(str::to_owned),
            error: "Chat storage operation failed".into(),
        });
    }
}

#[cfg(test)]
mod storage_tests {
    use super::*;

    #[test]
    fn storage_errors_are_limited_per_chat_and_resume_after_ten_seconds() {
        let deps = crate::test_support::FakeDeps::arc();
        let shared = ChatShared::new(deps.clone());
        let error = mainframe_types::seam_error::SeamError::msg("private sqlite error");
        shared.report_storage_error(Some("a"), &error);
        shared.report_storage_error(Some("a"), &error);
        shared.report_storage_error(Some("b"), &error);
        assert_eq!(deps.events().len(), 2);
        shared.storage_errors.lock_recover().insert(
            "a".into(),
            std::time::Instant::now() - std::time::Duration::from_secs(11),
        );
        shared.report_storage_error(Some("a"), &error);
        let ids: Vec<_> = deps
            .events()
            .into_iter()
            .map(|event| match event {
                DaemonEvent::Error { chat_id, .. } => chat_id,
                _ => panic!("expected error"),
            })
            .collect();
        assert_eq!(
            ids,
            vec![Some("a".into()), Some("b".into()), Some("a".into())]
        );
    }
}
