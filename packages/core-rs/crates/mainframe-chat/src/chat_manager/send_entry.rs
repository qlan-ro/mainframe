//! The message send path + CLI-owned queue delegations off the `ChatManager` facade.
use super::*;
use mainframe_types::sync::LockExt as _;

pub(super) type LiveSession = (Arc<Mutex<ActiveChat>>, Arc<dyn AdapterSession>);

impl ChatManager {
    pub async fn send_message(
        &self,
        chat_id: &str,
        content: &str,
        attachment_ids: Option<&[String]>,
        command: Option<CommandMeta>,
    ) -> Result<(), SendError> {
        // Register before reading any registry/cache state; the guard drops on
        // every return path below, `?` included.
        let _send_guard = self.lifecycle.begin_send(chat_id).await;

        let chat = self.get_chat(chat_id);
        if let Some(chat) = &chat
            && chat.worktree_missing == Some(true)
        {
            self.emit_worktree_missing_error(chat_id, chat).await;
            return Ok(());
        }

        self.reset_transcript_if_orphaned(chat_id, chat.as_ref())
            .await?;

        self.lifecycle.wait_for_interrupt(chat_id).await;

        // Before the spawn: a returning session too full for a delta moves
        // the segment onto a fresh native session, which the spawn must see.
        // A CLI-native slash command carries no handoff; it stays pending.
        let handoff = match &command {
            Some(cmd) if cmd.source != "mainframe" => None,
            _ => {
                let size = handoff_send::OutgoingSize {
                    text_bytes: content.len() as u64,
                    attachments: attachment_ids.map_or(0, |ids| ids.len() as u64),
                };
                self.prepare_handoff(chat_id, size).await?
            }
        };

        if !self.session_is_spawned(chat_id) {
            self.lifecycle.start_chat(chat_id).await;
        }

        let (post, session) = self.require_live_session(chat_id)?;
        info!(chat_id, "user message sent");
        self.mark_turn_accepted(&post, chat_id);

        if let Some(cmd) = command {
            return self
                .dispatch_command(cmd, &post, &session, chat_id, content, handoff.as_deref())
                .await;
        }
        self.send_plain_text(
            &post,
            &session,
            chat_id,
            content,
            attachment_ids,
            Delivery::Turn {
                handoff: handoff.as_deref(),
            },
        )
        .await
    }

    /// Stamp turn start (for `onResult`'s `turnDurationMs`) and tell the chat
    /// surface the manager has taken ownership of this prompt — accepted
    /// whether it dispatches immediately or lands behind a running turn
    /// (`send_plain_text`/`dispatch_command` fire the matching `TurnStarted`).
    fn mark_turn_accepted(&self, post: &Arc<Mutex<ActiveChat>>, chat_id: &str) {
        post.lock_recover().turn_started_at = Some(now_ms());
        self.event_handler.notify_chat_surface(
            crate::chat_surface::ChatSurfaceEvent::TurnAccepted {
                chat_id: chat_id.to_string(),
            },
        );
    }

    /// Loads any existing history into the cache FIRST: a cold or evicted
    /// chat's cache is empty, and appending straight into it would replace the
    /// whole transcript with just this one error message — the next resume
    /// snapshot then shows nothing else.
    async fn emit_worktree_missing_error(&self, chat_id: &str, chat: &Chat) {
        self.get_messages(chat_id).await;
        let error_msg = self.messages.lock_recover()
            .create_transient_message(
                chat_id,
                ChatMessageType::Error,
                vec![MessageContent::Node(mainframe_types::chat::MessageContentNode::Error {
                    message: format!(
                        "Worktree directory no longer exists: {}. Archive this session or recreate the worktree.",
                        chat.worktree_path.as_deref().unwrap_or_default()
                    ),
                    parent_tool_use_id: None,
                })],
                None,
            );
        self.messages.lock_recover().append(chat_id, error_msg);
        self.event_handler.emit_display(chat_id);
    }

    fn session_is_spawned(&self, chat_id: &str) -> bool {
        self.get_active(chat_id)
            .map(|c| {
                c.lock_recover()
                    .session
                    .as_ref()
                    .is_some_and(|s| s.is_spawned())
            })
            .unwrap_or(false)
    }

    // Transcript gone + no live CLI: `--resume` would target a dead session id.
    // Apply the same reset as the card's "Continue here" so this send spawns fresh.
    async fn reset_transcript_if_orphaned(
        &self,
        chat_id: &str,
        chat: Option<&Chat>,
    ) -> Result<(), SendError> {
        let transcript_missing = chat.and_then(|c| c.transcript_missing).unwrap_or(false);
        if transcript_missing && !self.session_is_spawned(chat_id) {
            self.continue_here(chat_id)
                .await
                .map_err(|e| SendError(e.to_string()))?;
        }
        Ok(())
    }

    pub(super) fn require_live_session(&self, chat_id: &str) -> Result<LiveSession, SendError> {
        let post = self
            .get_active(chat_id)
            .ok_or_else(|| SendError(format!("Chat {chat_id} not running")))?;
        let session = {
            let guard = post.lock_recover();
            match guard.session.clone() {
                Some(s) if s.is_spawned() => s,
                _ => return Err(SendError(format!("Chat {chat_id} not running"))),
            }
        };
        Ok((post, session))
    }

    pub(super) fn set_working(&self, cell: &Arc<Mutex<ActiveChat>>, chat_id: &str, now: &str) {
        {
            let mut guard = cell.lock_recover();
            guard.chat.process_state = Some(Some(ProcessState::Working));
            guard.chat.updated_at = now.to_string();
        }
        self.deps.chats_update(
            chat_id,
            &ChatUpdate {
                process_state: Some(Some(ProcessState::Working)),
                updated_at: Some(now.to_string()),
                ..Default::default()
            },
        );
    }

    pub async fn edit_queued_message(
        &self,
        chat_id: &str,
        message_id: &str,
        content: &str,
    ) -> Result<(), SendError> {
        let r = self.find_ref(chat_id, message_id);
        let Some(r) = r else {
            return Ok(());
        };
        let Some(session) = self.get_session_for_chat(chat_id) else {
            return Ok(());
        };

        let cancelled = session.cancel_queued_message(r.uuid.clone()).await?;
        if !cancelled {
            info!(
                chat_id,
                uuid = r.uuid,
                "edit lost race: original already dequeued by CLI"
            );
            return Ok(());
        }

        self.queued_refs.lock_recover().retain(|q| q.uuid != r.uuid);
        self.notify_queue_changed(chat_id);
        self.messages
            .lock_recover()
            .remove_by_id(chat_id, &r.message_id);
        self.event_handler.emit_display(chat_id);

        self.send_message(chat_id, content, r.attachment_ids.as_deref(), None)
            .await
    }

    pub async fn cancel_queued_message(
        &self,
        chat_id: &str,
        message_id: &str,
    ) -> Result<(), SendError> {
        let r = self.find_ref(chat_id, message_id);
        let Some(r) = r else {
            return Ok(());
        };
        let Some(session) = self.get_session_for_chat(chat_id) else {
            return Ok(());
        };

        let cancelled = session.cancel_queued_message(r.uuid.clone()).await?;
        if !cancelled {
            info!(
                chat_id,
                uuid = r.uuid,
                "cancel lost race: message already dequeued by CLI"
            );
            return Ok(());
        }

        self.queued_refs.lock_recover().retain(|q| q.uuid != r.uuid);
        self.messages
            .lock_recover()
            .remove_by_id(chat_id, &r.message_id);
        self.notify_queue_changed(chat_id);
        self.event_handler.emit_display(chat_id);
        info!(chat_id, uuid = r.uuid, "queued message cancelled in CLI");
        Ok(())
    }

    /// How many accepted prompts are queued behind this chat's running turn.
    /// The ACP facade's prompt port reads this right after `send_message` to
    /// fill the queued-state extension metadata.
    pub fn queued_message_count(&self, chat_id: &str) -> usize {
        self.queued_refs
            .lock_recover()
            .iter()
            .filter(|r| r.chat_id == chat_id)
            .count()
    }

    fn find_ref(&self, chat_id: &str, message_id: &str) -> Option<QueuedMessageRef> {
        self.queued_refs
            .lock_recover()
            .iter()
            .find(|r| r.chat_id == chat_id && r.message_id == message_id)
            .cloned()
    }
}
