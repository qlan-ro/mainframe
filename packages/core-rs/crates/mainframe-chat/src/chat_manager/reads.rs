//! Registry/queue reads, enriched registry reads, and in-memory cache sync.
use super::*;

impl ChatManager {
    pub fn get_chat(&self, chat_id: &str) -> Option<Chat> {
        let mut chat = self
            .get_active(chat_id)
            .map(|c| c.lock().unwrap_or_else(|e| e.into_inner()).chat.clone())
            .or_else(|| self.deps.chats_get(chat_id))?;
        self.enricher.enrich(&mut chat);
        Some(chat)
    }

    pub fn list_chats(&self, project_id: &str) -> Vec<Chat> {
        self.enrich_all(self.deps.chats_list(project_id))
    }

    pub fn list_all_chats(&self) -> Vec<Chat> {
        self.enrich_all(self.deps.chats_list_all())
    }

    fn enrich_all(&self, mut chats: Vec<Chat>) -> Vec<Chat> {
        for chat in &mut chats {
            self.enricher.enrich(chat);
        }
        chats
    }

    pub fn is_chat_running(&self, chat_id: &str) -> bool {
        self.get_active(chat_id)
            .map(|c| {
                c.lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .session
                    .as_ref()
                    .is_some_and(|s| s.is_spawned())
            })
            .unwrap_or(false)
    }

    pub fn get_session_for_chat(&self, chat_id: &str) -> Option<Arc<dyn AdapterSession>> {
        self.get_active(chat_id)
            .and_then(|c| c.lock().unwrap_or_else(|e| e.into_inner()).session.clone())
    }

    /// Return all queued refs for a chat, oldest-first (enqueue order) —
    /// `queue_state` snapshots render in this order, so it is part of the wire
    /// contract, not a courtesy.
    pub fn get_queued_for_chat(&self, chat_id: &str) -> Vec<QueuedMessageRef> {
        queued_for_chat(&self.queued_refs, chat_id)
    }

    /// Announce the chat's current queued snapshot on the chat-surface seam
    /// (`_mainframe.dev/queue_state` on the facade). Always the full set.
    pub(super) fn notify_queue_changed(&self, chat_id: &str) {
        self.event_handler.notify_chat_surface(
            crate::chat_surface::ChatSurfaceEvent::QueueChanged {
                chat_id: chat_id.to_string(),
                refs: self.get_queued_for_chat(chat_id),
            },
        );
    }

    pub fn handle_queued_processed(&self, chat_id: &str, uuid: &str) {
        handle_queued_processed(&self.queued_refs, chat_id, uuid);
    }

    pub fn clear_all_queued_for_chat(&self, chat_id: &str) {
        clear_all_queued_for_chat(&self.queued_refs, chat_id);
    }

    // ── registry reads (enriched) ────────────────────────────────────────────

    pub fn list_filtered(
        &self,
        project_id: Option<&str>,
        tags_all: Option<&[String]>,
        has_worktree: bool,
        include_archived: bool,
        include_temporary: bool,
    ) -> Vec<Chat> {
        self.enrich_all(self.deps.chats_list_filtered(
            project_id,
            tags_all,
            has_worktree,
            include_archived,
            include_temporary,
        ))
    }

    /// Working directory for `chatId`: the worktree path when present and still on
    /// disk, else the project root. `None` when the chat/project is unknown or the
    /// worktree was deleted (`worktreeMissing`).
    pub fn get_effective_path(&self, chat_id: &str) -> Option<String> {
        let chat = self.get_chat(chat_id)?;
        if let Some(wt) = chat.worktree_path.clone() {
            if chat.worktree_missing == Some(true) {
                return None;
            }
            return Some(wt);
        }
        self.deps.projects_get_path(&chat.project_id)
    }

    pub fn get_project_path(&self, project_id: &str) -> Option<String> {
        self.deps.projects_get_path(project_id)
    }

    pub fn get_chat_project_id(&self, chat_id: &str) -> Option<String> {
        self.get_chat(chat_id).map(|c| c.project_id)
    }

    // ── in-memory cache sync + out-of-band broadcast ─────────────────────────

    /// Mirror the persisted tags onto the cached active chat so a later
    /// `chat.updated` (e.g. from resumeChat) does not broadcast stale tags.
    pub fn sync_chat_tags(&self, chat_id: &str, tags: Vec<String>) {
        if let Some(cell) = self.get_active(chat_id) {
            cell.lock().unwrap_or_else(|e| e.into_inner()).chat.tags = Some(tags);
        }
    }

    /// Apply a partial DB-backed update to the cached active chat (same staleness
    /// guard as `sync_chat_tags`). Only present fields are written.
    pub fn sync_chat_fields(&self, chat_id: &str, partial: ChatFieldsPartial) {
        let Some(cell) = self.get_active(chat_id) else {
            return;
        };
        let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(v) = partial.effort {
            guard.chat.effort = Some(v);
        }
        if let Some(v) = partial.fast {
            guard.chat.fast = Some(v);
        }
        if let Some(v) = partial.ultracode {
            guard.chat.ultracode = Some(v);
        }
        if let Some(v) = partial.adaptive_thinking {
            guard.chat.adaptive_thinking = Some(v);
        }
        if let Some(v) = partial.pinned {
            guard.chat.pinned = Some(v);
        }
    }

    /// Broadcast `chat.updated` for a chat whose fields were persisted out-of-band
    /// (e.g. the tuning PATCH). Mirrors `notify_worktree_deleted`'s enriched re-emit.
    pub fn emit_chat_updated(&self, chat_id: &str) {
        if let Some(chat) = self.get_chat(chat_id) {
            self.emit(DaemonEvent::ChatUpdated { chat, reason: None });
        }
    }

    /// Re-reads a chat's agent lineage and delegation state into its cached
    /// cell, then announces the chat. The orchestration server calls this when
    /// a task, the lineage, or the chat's agent outbox changes; without it the
    /// cell keeps what was read when the chat loaded.
    pub fn refresh_agent_lineage(&self, chat_id: &str) {
        if let Some(cell) = self.get_active(chat_id)
            && let Some(row) = self.deps.chats_get(chat_id)
        {
            let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            guard.chat.orchestration = row.orchestration;
            guard.chat.parent_chat_id = row.parent_chat_id;
        }
        self.emit_chat_updated(chat_id);
    }

    /// Re-emit `chat.updated` for every non-archived chat bound to `worktree_path`
    /// so clients pick up the new `worktreeMissing` flag.
    pub fn notify_worktree_deleted(&self, worktree_path: &str) {
        for chat in self.deps.chats_list_all() {
            if chat.worktree_path.as_deref() != Some(worktree_path) {
                continue;
            }
            self.emit(DaemonEvent::ChatUpdated { chat, reason: None });
        }
    }

    /// Live-apply resolved tuning to the running session, if any.
    pub async fn apply_tuning(&self, chat_id: &str) {
        apply_tuning_impl(&self.active_chats, &self.deps, chat_id).await;
    }

    /// Record a mention and refresh the session context.
    pub fn add_mention(&self, chat_id: &str, mention: SessionMention) {
        self.deps.chats_add_mention(chat_id, &mention);
        self.emit(DaemonEvent::ContextUpdated {
            chat_id: chat_id.to_string(),
            file_paths: None,
        });
    }
}
