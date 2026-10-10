//! History, context, and degraded-recovery delegations off the `ChatManager` facade.
use super::*;

pub use mainframe_types::resume::ResumeSnapshot;

impl ChatManager {
    /// Cached messages, falling back to a one-shot on-disk history load (Claude
    /// `--resume` JSONL). The load remaps the embedded Claude sessionId back to the
    /// Mainframe chatId and restores any pending permission from history.
    pub async fn get_messages(&self, chat_id: &str) -> Vec<ChatMessage> {
        self.lifecycle.await_loading(chat_id).await;
        // Wait out an in-flight offload before reading the cache/registry: an
        // offload that just cleared the cache must not race a reader that would
        // otherwise see a half-cleared cache and skip straight to disk
        // (harmless) or, conversely, read a cache the offload is about to
        // clear.
        self.lifecycle.await_offload(chat_id).await;

        if let Some(cached) = self.cached_messages(chat_id) {
            return cached;
        }

        // Single-flight the on-disk read (Established facts: two concurrent
        // misses used to both hit disk). The follower re-reads the cache the
        // leader just populated instead of loading a second time.
        if !self.lifecycle.claim_history(chat_id).await {
            return self.cached_messages(chat_id).unwrap_or_default();
        }
        let result = self.load_history_into_cache(chat_id).await;
        self.lifecycle.release_history(chat_id);
        result
    }

    fn cached_messages(&self, chat_id: &str) -> Option<Vec<ChatMessage>> {
        let cached = self
            .messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(chat_id)
            .cloned();
        cached.filter(|c| !c.is_empty())
    }

    /// The lead caller's actual disk read behind `claim_history`'s single
    /// flight: consult the history snapshot cache first (a hit skips the
    /// parse entirely), else load + remap as before and write a snapshot for
    /// next time; either way, cache in memory + restore any pending
    /// permission found in the transcript (when non-empty).
    async fn load_history_into_cache(&self, chat_id: &str) -> Vec<ChatMessage> {
        // Multi-segment chats compose from several transcripts; the snapshot
        // cache keys on one session's sources, so they bypass it.
        if let Some(composed) = deps_lifecycle::compose_if_multi(self.deps.as_ref(), chat_id).await
        {
            return self.finish_composed_load(chat_id, composed);
        }
        let Some(session) = self.history_session(chat_id) else {
            return Vec::new();
        };
        let sources = session.history_sources().await;
        let fingerprint = HistoryFingerprint::compute(&sources).await;
        if let Some(fp) = &fingerprint
            && let Some(cached) = self.history_cache.read(chat_id, fp).await
        {
            return self.finish_history_load(chat_id, cached);
        }

        match session.load_history().await {
            Ok(history) => {
                let remapped = remap_history(history, chat_id);
                if let Some(fp) = fingerprint {
                    self.history_cache.write_in_background(
                        chat_id.to_string(),
                        fp,
                        remapped.clone(),
                    );
                }
                self.finish_history_load(chat_id, remapped)
            }
            Err(_) => Vec::new(),
        }
    }

    /// Shared tail of a cache hit and a cache miss: settle `remapped` into
    /// the in-memory cache and restore any pending permission it carries.
    /// Skipped for an empty history — same early-out the pre-cache code had,
    /// so an adapter session with nothing to load never pins an empty entry.
    fn finish_history_load(&self, chat_id: &str, remapped: Vec<ChatMessage>) -> Vec<ChatMessage> {
        if remapped.is_empty() {
            return remapped;
        }
        let remapped = {
            let mut messages = self.messages.lock().unwrap_or_else(|e| e.into_inner());
            messages.set_and_snapshot(chat_id, remapped)
        };
        self.permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .restore_pending_permission(chat_id, &remapped);
        remapped
    }

    /// A pending permission is restored only from the active segment's slice:
    /// a dangling request in an earlier segment's transcript is never revived.
    fn finish_composed_load(
        &self,
        chat_id: &str,
        composed: crate::segments::compose::Composed,
    ) -> Vec<ChatMessage> {
        if composed.messages.is_empty() {
            return composed.messages;
        }
        let stored = {
            let mut messages = self.messages.lock().unwrap_or_else(|e| e.into_inner());
            messages.set_and_snapshot(chat_id, composed.messages)
        };
        let active_slice = &stored[composed.active_from.min(stored.len())..];
        self.permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .restore_pending_permission(chat_id, active_slice);
        stored
    }

    /// Load messages from disk, bypassing the in-memory cache (session-files route
    /// needs subagent file changes absent from the cache during an active session).
    pub async fn get_messages_from_disk(&self, chat_id: &str) -> Vec<ChatMessage> {
        if let Some(composed) = deps_lifecycle::compose_if_multi(self.deps.as_ref(), chat_id).await
        {
            return composed.messages;
        }
        let Some(session) = self.history_session(chat_id) else {
            return Vec::new();
        };
        match session.load_history().await {
            Ok(history) => remap_history(history, chat_id),
            Err(err) => {
                tracing::warn!(?err, chat_id, "getMessagesFromDisk failed");
                Vec::new()
            }
        }
    }

    /// Display history + transcript presence in one typed result, so the REST
    /// route (and the UI) can tell an empty thread from a deleted transcript.
    /// Reconciling here persists flag flips and broadcasts `chat.updated`.
    pub async fn get_display_messages(&self, chat_id: &str) -> ChatHistoryPayload {
        let raw = self.get_messages(chat_id).await;
        let categories = self.deps.get_tool_categories(chat_id);
        let messages = self
            .deps
            .prepare_messages_for_client(&raw, categories.as_ref());
        let transcript_missing = match self.get_chat(chat_id) {
            Some(mut chat) => self.reconcile_transcript(&mut chat).await,
            None => false,
        };
        ChatHistoryPayload {
            messages,
            transcript_missing,
            workflow_runs: Vec::new(),
        }
    }

    /// Reconcile the persisted `transcriptMissing` flag against the transcript file
    /// on disk.
    pub async fn reconcile_transcript(&self, chat: &mut Chat) -> bool {
        let presence = self.presence_deps();
        crate::transcript_presence::reconcile_transcript_presence(&presence, chat).await
    }

    /// Forget the dead CLI session so the next send spawns fresh in the same chat row.
    pub async fn continue_here(&self, chat_id: &str) -> Result<(), DegradedRecoveryError> {
        let wrapper = self.recovery_wrapper();
        crate::degraded_recovery::continue_here(&wrapper, chat_id).await
    }

    /// Detach the chat from its deleted worktree and rebind it to the project root.
    pub async fn continue_in_project_root(
        &self,
        chat_id: &str,
    ) -> Result<(), DegradedRecoveryError> {
        let wrapper = self.recovery_wrapper();
        crate::degraded_recovery::continue_in_project_root(&wrapper, chat_id).await
    }

    /// Re-add the deleted worktree at its stored path from the stored branch (409 when branch gone).
    pub async fn recreate_worktree(&self, chat_id: &str) -> Result<(), DegradedRecoveryError> {
        let wrapper = self.recovery_wrapper();
        crate::degraded_recovery::recreate_chat_worktree(&wrapper, chat_id).await
    }

    /// Build a stateless history-load session for `chat_id`, or `None` when the chat
    /// has no Claude session / adapter / project. Mirrors `getMessages`'s guard chain.
    fn history_session(&self, chat_id: &str) -> Option<Arc<dyn AdapterSession>> {
        let chat = self.get_chat(chat_id)?;
        build_history_session(&self.deps, &chat, chat_id)
    }

    /// Resume-replay snapshot: display history plus any still-open gate for
    /// `chat_id`, gathered in one call so the ACP facade's `session/resume`
    /// doesn't have to sequence `get_messages`/`get_pending_permission` itself.
    ///
    /// Keeps its `get_messages` load (so a cold chat's transcript is read
    /// exactly once), then reads `EventHandler::display_snapshot` instead of
    /// re-running `prepare`: that call brings the chat's projection current
    /// under the cache lock, the same step a live emission uses, without
    /// notifying — so a snapshot taken mid-stream matches a live
    /// `DisplayRevision` taken at the same moment, and any delta it produces
    /// carries forward to the next live emission rather than being lost.
    /// `on_message` removes the overlay before it appends the final message, so
    /// this order cannot yield both the final message and the overlay — the
    /// append's own display revision is buffered from `begin_resume` and the
    /// catch-up restores it. The overlay never enters the settled cache: this
    /// read neither writes the cache nor persists the overlay anywhere.
    pub async fn get_resume_snapshot(&self, chat_id: &str) -> ResumeSnapshot {
        let raw = self.get_messages(chat_id).await;
        let (messages, streaming) = self.event_handler.display_snapshot(chat_id, &raw);
        // Reconcile the persisted `transcriptMissing` flag the same way
        // `get_display_messages` did — the resume snapshot doesn't surface
        // the flag itself, only the side effect (persist + broadcast).
        if let Some(mut chat) = self.get_chat(chat_id) {
            self.reconcile_transcript(&mut chat).await;
        }
        // `get_messages` already loaded the transcript and restored any
        // pending permission from it, so read the restored state rather than
        // letting `get_pending_permission` load it a second time.
        let pending = self.permission_handler.pending_permission_as_known(chat_id);
        ResumeSnapshot {
            messages,
            streaming,
            pending,
        }
    }

    pub async fn get_session_context(&self, chat_id: &str, project_path: &str) -> SessionContext {
        let session = self.get_session_for_chat(chat_id);
        let adapter_id = self.get_chat(chat_id).map(|c| c.adapter_id);
        self.deps
            .get_session_context(chat_id, project_path, session, adapter_id)
            .await
    }
}
