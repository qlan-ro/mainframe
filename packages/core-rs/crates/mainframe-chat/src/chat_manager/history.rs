//! History, context, and degraded-recovery delegations off the `ChatManager` facade.
use super::*;
use mainframe_adapter_api::AdapterError;
use mainframe_types::sync::LockExt as _;

pub use mainframe_types::resume::ResumeSnapshot;

impl ChatManager {
    /// Load messages from disk, bypassing the in-memory cache (session-files route
    /// needs subagent file changes absent from the cache during an active session).
    pub async fn get_messages_from_disk(&self, chat_id: &str) -> Vec<ChatMessage> {
        if let Some(composed) = compose_if_multi(self.shared.deps.as_ref(), chat_id).await {
            return composed.messages;
        }
        let Some(session) = self.history_session(chat_id) else {
            return Vec::new();
        };
        match session.load_history().await {
            Ok(history) => match self
                .shared
                .merge_idle_history(chat_id, remap_history(history, chat_id))
            {
                Ok(history) => history,
                Err(_) => {
                    tracing::warn!(chat_id, "idle history provenance unavailable");
                    Vec::new()
                }
            },
            Err(err) => {
                tracing::warn!(error = ?err, chat_id, "getMessagesFromDisk failed");
                Vec::new()
            }
        }
    }

    /// Display history + transcript presence in one typed result, so the REST
    /// route (and the UI) can tell an empty thread from a deleted transcript.
    /// Reconciling here persists flag flips and broadcasts `chat.updated`.
    pub async fn get_display_messages(&self, chat_id: &str) -> ChatHistoryPayload {
        let raw = self.get_messages(chat_id).await;
        let categories = self.shared.deps.get_tool_categories(chat_id);
        let messages =
            self.shared
                .deps
                .prepare_messages_for_client(chat_id, &raw, categories.as_ref());
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
        crate::transcript_presence::reconcile_transcript_presence(&self.shared, chat).await
    }

    /// Forget the dead CLI session so the next send spawns fresh in the same chat row.
    pub async fn continue_here(&self, chat_id: &str) -> Result<(), DegradedRecoveryError> {
        crate::degraded_recovery::continue_here(&self.shared, &self.event_handler, chat_id).await
    }

    /// Detach the chat from its deleted worktree and rebind it to the project root.
    pub async fn continue_in_project_root(
        &self,
        chat_id: &str,
    ) -> Result<(), DegradedRecoveryError> {
        crate::degraded_recovery::continue_in_project_root(&self.shared, chat_id).await
    }

    /// Re-add the deleted worktree at its stored path from the stored branch (409 when branch gone).
    pub async fn recreate_worktree(&self, chat_id: &str) -> Result<(), DegradedRecoveryError> {
        crate::degraded_recovery::recreate_chat_worktree(&self.shared, chat_id).await
    }

    pub async fn get_subagent_history(
        &self,
        chat_id: &str,
        agent_id: String,
    ) -> Result<Vec<mainframe_types::display::DisplayMessage>, AdapterError> {
        let session = self
            .history_session(chat_id)
            .ok_or(AdapterError::Unavailable("Chat history is unavailable"))?;
        let raw = session.load_subagent_history(agent_id).await?;
        let categories = self.shared.deps.get_tool_categories(chat_id);
        Ok(self
            .shared
            .deps
            .prepare_messages_for_client(chat_id, &raw, categories.as_ref()))
    }

    /// Build a stateless history-load session using the chat's worktree,
    /// scratch directory, or project path.
    pub(super) fn history_session(&self, chat_id: &str) -> Option<Arc<dyn AdapterSession>> {
        let chat = self.get_chat(chat_id)?;
        build_history_session(&self.shared.deps, &chat, chat_id)
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
        self.read_resume_snapshot(chat_id, |messages, streaming, pending| ResumeSnapshot {
            messages: messages.to_vec(),
            streaming,
            pending,
        })
        .await
    }

    pub async fn read_resume_snapshot<R>(
        &self,
        chat_id: &str,
        read: impl FnOnce(
            &[mainframe_types::display::DisplayMessage],
            Option<mainframe_types::display::StreamingLeafKind>,
            Option<mainframe_types::adapter::ControlRequest>,
        ) -> R,
    ) -> R {
        let read = match self.try_read_cached_resume(chat_id, read).await {
            Ok(result) => return result,
            Err(read) => read,
        };
        let raw = self.get_messages(chat_id).await;
        if let Some(mut chat) = self.get_chat(chat_id) {
            self.reconcile_transcript(&mut chat).await;
        }
        let pending = self.permission_handler.pending_permission_as_known(chat_id);
        self.event_handler
            .read_display_snapshot(chat_id, &raw, |messages, streaming| {
                read(messages, streaming, pending)
            })
    }

    async fn try_read_cached_resume<R, F>(&self, chat_id: &str, read: F) -> Result<R, F>
    where
        F: FnOnce(
            &[mainframe_types::display::DisplayMessage],
            Option<mainframe_types::display::StreamingLeafKind>,
            Option<mainframe_types::adapter::ControlRequest>,
        ) -> R,
    {
        self.lifecycle.await_restoring(chat_id).await;
        self.lifecycle.await_offload(chat_id).await;
        let present = self
            .shared
            .messages
            .lock_recover()
            .get(chat_id)
            .is_some_and(|messages| !messages.is_empty());
        if !present {
            return Err(read);
        }
        // Reading a chat's history is a use of it.
        self.lifecycle.touch(chat_id);
        if let Some(mut chat) = self.get_chat(chat_id) {
            self.reconcile_transcript(&mut chat).await;
        }
        self.event_handler.try_read_cached_resume(chat_id, read)
    }

    pub async fn get_session_context(
        &self,
        chat_id: &str,
        project_path: &str,
    ) -> Result<SessionContext, mainframe_types::seam_error::SeamError> {
        let session = self.get_session_for_chat(chat_id);
        let adapter_id = self.get_chat(chat_id).map(|c| c.adapter_id);
        self.shared
            .deps
            .get_session_context(chat_id, project_path, session, adapter_id)
            .await
    }
}
