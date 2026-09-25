//! History, context, and degraded-recovery delegations off the `ChatManager` facade.
use super::*;

impl ChatManager {
    /// Cached messages, falling back to a one-shot on-disk history load (Claude
    /// `--resume` JSONL). The load remaps the embedded Claude sessionId back to the
    /// Mainframe chatId and restores any pending permission from history.
    pub async fn get_messages(&self, chat_id: &str) -> Vec<ChatMessage> {
        self.lifecycle.await_loading(chat_id).await;
        // Wait out an in-flight offload before reading the cache/registry: an
        // offload that just cleared the cache must not race a reader that
        // would otherwise see a half-cleared cache and skip straight to disk
        // (harmless) or, conversely, read a cache the offload is about to
        // clear (todo #178).
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
    /// flight: load, remap, and (when non-empty) cache + restore any pending
    /// permission found in the transcript.
    async fn load_history_into_cache(&self, chat_id: &str) -> Vec<ChatMessage> {
        let Some(session) = self.history_session(chat_id) else {
            return Vec::new();
        };
        match session.load_history().await {
            Ok(history) => {
                let remapped = remap_history(history, chat_id);
                if !remapped.is_empty() {
                    self.messages
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .set(chat_id, remapped.clone());
                    self.permissions
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .restore_pending_permission(chat_id, &remapped);
                }
                remapped
            }
            Err(_) => Vec::new(),
        }
    }

    /// Load messages from disk, bypassing the in-memory cache (session-files route
    /// needs subagent file changes absent from the cache during an active session).
    pub async fn get_messages_from_disk(&self, chat_id: &str) -> Vec<ChatMessage> {
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
        let wrapper = self.recovery_wrapper();
        crate::transcript_presence::reconcile_transcript_presence(&wrapper, chat).await
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

    /// Resume-replay snapshot (todo #350, plan task 15): display history plus
    /// any still-open gate for `chat_id`, gathered in one call so the ACP
    /// facade's `session/resume` doesn't have to sequence
    /// `get_display_messages`/`get_pending_permission` itself.
    pub async fn get_resume_snapshot(
        &self,
        chat_id: &str,
    ) -> (
        Vec<DisplayMessage>,
        Option<mainframe_types::adapter::ControlRequest>,
    ) {
        let payload = self.get_display_messages(chat_id).await;
        // `get_display_messages` already loaded the transcript and restored
        // any pending permission from it, so read the restored state rather
        // than letting `get_pending_permission` load it a second time.
        let pending = self.permission_handler.pending_permission_as_known(chat_id);
        (payload.messages, pending)
    }

    pub async fn get_session_context(&self, chat_id: &str, project_path: &str) -> SessionContext {
        let session = self.get_session_for_chat(chat_id);
        let adapter_id = self.get_chat(chat_id).map(|c| c.adapter_id);
        self.deps
            .get_session_context(chat_id, project_path, session, adapter_id)
            .await
    }
}
