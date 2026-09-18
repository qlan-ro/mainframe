//! Shared-internals wrapper for the transcript-presence + degraded-recovery
//! deps traits, and its `ChatManager` accessor.
use super::*;

/// Shared-internals wrapper implementing the transcript-presence + degraded-
/// recovery deps traits (the Rust analogue of the TS closures over `this` that
/// build `reconcileTranscript`/`recoveryDeps`). Constructed on demand.
pub(super) struct RecoveryWrapper {
    deps: Arc<dyn ChatManagerDeps>,
    active_chats: Registry,
    permissions: Arc<Mutex<PermissionManager>>,
    messages: Arc<Mutex<MessageCache>>,
    event_handler: Arc<EventHandler<EhDeps>>,
}

impl RecoveryWrapper {
    fn active_chat_mut(&self, chat_id: &str, f: impl FnOnce(&mut Chat)) {
        if let Some(cell) = self.active_chats.get(chat_id) {
            let cell = cell.value().clone();
            let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            f(&mut guard.chat);
        }
    }
    fn current_chat(&self, chat_id: &str) -> Option<Chat> {
        self.active_chats
            .get(chat_id)
            .map(|c| {
                c.value()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .chat
                    .clone()
            })
            .or_else(|| self.deps.chats_get(chat_id))
    }
}

impl TranscriptPresenceDeps for RecoveryWrapper {
    fn chats_update_transcript_missing(&self, chat_id: &str, missing: bool) {
        self.deps.chats_update(
            chat_id,
            &ChatUpdate {
                transcript_missing: Some(missing),
                ..Default::default()
            },
        );
    }
    fn projects_get_path(&self, project_id: &str) -> Option<String> {
        self.deps.projects_get_path(project_id)
    }
    fn is_transcript_present<'a>(
        &'a self,
        adapter_id: &'a str,
        session_id: &'a str,
        project_path: &'a str,
        session_file_path: Option<&'a str>,
    ) -> BoxFuture<'a, Option<bool>> {
        self.deps
            .is_transcript_present(adapter_id, session_id, project_path, session_file_path)
    }
    fn sync_chat_fields_transcript_missing(&self, chat_id: &str, missing: bool) {
        self.active_chat_mut(chat_id, |chat| chat.transcript_missing = Some(missing));
    }
    fn emit_event(&self, event: DaemonEvent) {
        enrich_and_emit(self.deps.as_ref(), &self.permissions, event);
    }
}

impl DegradedRecoveryDeps for RecoveryWrapper {
    fn chats_get(&self, chat_id: &str) -> Option<Chat> {
        self.deps.chats_get(chat_id)
    }
    fn projects_get_path(&self, project_id: &str) -> Option<String> {
        self.deps.projects_get_path(project_id)
    }
    fn chats_clear_session(&self, chat_id: &str) {
        self.deps.chats_clear_session(chat_id);
    }
    fn chats_clear_worktree(&self, chat_id: &str) {
        self.deps.chats_clear_worktree(chat_id);
    }
    fn get_active_session(&self, chat_id: &str) -> Option<Arc<dyn AdapterSession>> {
        self.active_chats.get(chat_id).and_then(|c| {
            c.value()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .session
                .clone()
        })
    }
    fn clear_active_session(&self, chat_id: &str) {
        if let Some(cell) = self.active_chats.get(chat_id) {
            cell.value()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .session = None;
        }
    }
    fn sync_chat_fields(&self, chat_id: &str, fields: RecoverySync) {
        self.active_chat_mut(chat_id, |chat| match fields {
            RecoverySync::ClearSession => {
                chat.claude_session_id = None;
                chat.session_file_path = None;
                chat.transcript_missing = Some(false);
            }
            RecoverySync::ClearWorktree => {
                chat.worktree_path = None;
                chat.branch_name = None;
            }
        });
    }
    fn emit_chat_updated(&self, chat_id: &str) {
        if let Some(chat) = self.current_chat(chat_id) {
            enrich_and_emit(
                self.deps.as_ref(),
                &self.permissions,
                DaemonEvent::ChatUpdated { chat, reason: None },
            );
        }
    }
    fn clear_messages(&self, chat_id: &str) {
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .delete(chat_id);
        self.event_handler.clear_display_state(chat_id);
    }
}

impl ChatManager {
    pub(super) fn recovery_wrapper(&self) -> RecoveryWrapper {
        RecoveryWrapper {
            deps: self.deps.clone(),
            active_chats: self.active_chats.clone(),
            permissions: self.permissions.clone(),
            messages: self.messages.clone(),
            event_handler: self.event_handler.clone(),
        }
    }
}
