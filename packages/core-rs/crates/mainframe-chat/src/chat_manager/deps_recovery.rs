//! Shared-internals wrappers for the transcript-presence and degraded-recovery
//! deps traits, and their `ChatManager` accessors.
use super::*;

/// Shared-internals wrapper implementing the degraded-recovery deps trait (the
/// Rust analogue of the TS closures over `this` that build `recoveryDeps`).
/// Constructed on demand.
pub(super) struct RecoveryWrapper {
    deps: Arc<dyn ChatManagerDeps>,
    active_chats: Registry,
    enricher: Enricher,
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

/// The transcript-presence deps over the three internals presence needs. Shared
/// by history reconcile ([`ChatManager::presence_deps`]) and the event handler's
/// worktree-tool refresh, which has no `RecoveryWrapper` to hand.
pub(super) struct PresenceDeps {
    pub(super) deps: Arc<dyn ChatManagerDeps>,
    pub(super) active_chats: Registry,
    pub(super) enricher: Enricher,
}

impl PresenceDeps {
    fn active_chat_mut(&self, chat_id: &str, f: impl FnOnce(&mut Chat)) {
        if let Some(cell) = self.active_chats.get(chat_id) {
            let cell = cell.value().clone();
            let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            f(&mut guard.chat);
        }
    }
}

impl TranscriptPresenceDeps for PresenceDeps {
    fn chats_update_transcript_missing(&self, chat_id: &str, missing: bool) {
        self.deps.chats_update(
            chat_id,
            &ChatUpdate {
                transcript_missing: Some(missing),
                ..Default::default()
            },
        );
    }
    fn chats_update_session_file_path(&self, chat_id: &str, path: &str) {
        self.deps.chats_update(
            chat_id,
            &ChatUpdate {
                session_file_path: Some(path.to_string()),
                ..Default::default()
            },
        );
    }
    fn projects_get_path(&self, project_id: &str) -> Option<String> {
        self.deps.projects_get_path(project_id)
    }
    fn locate_transcript<'a>(
        &'a self,
        adapter_id: &'a str,
        session_id: &'a str,
        project_path: &'a str,
        session_file_path: Option<&'a str>,
    ) -> BoxFuture<'a, Option<mainframe_types::transcript::TranscriptLocation>> {
        self.deps
            .locate_transcript(adapter_id, session_id, project_path, session_file_path)
    }
    fn sync_chat_fields_transcript_missing(&self, chat_id: &str, missing: bool) {
        self.active_chat_mut(chat_id, |chat| chat.transcript_missing = Some(missing));
    }
    fn sync_chat_fields_session_file_path(&self, chat_id: &str, path: &str) {
        self.active_chat_mut(chat_id, |chat| {
            chat.session_file_path = Some(path.to_string());
        });
    }
    fn emit_event(&self, event: DaemonEvent) {
        self.enricher.emit(event);
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
            self.enricher
                .emit(DaemonEvent::ChatUpdated { chat, reason: None });
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
    pub(super) fn presence_deps(&self) -> PresenceDeps {
        PresenceDeps {
            deps: self.deps.clone(),
            active_chats: self.active_chats.clone(),
            enricher: self.enricher.clone(),
        }
    }

    pub(super) fn recovery_wrapper(&self) -> RecoveryWrapper {
        RecoveryWrapper {
            deps: self.deps.clone(),
            active_chats: self.active_chats.clone(),
            enricher: self.enricher.clone(),
            messages: self.messages.clone(),
            event_handler: self.event_handler.clone(),
        }
    }
}
