//! The message send path + CLI-owned queue delegations off the `ChatManager` facade.
use super::*;

type LiveSession = (Arc<Mutex<ActiveChat>>, Arc<dyn AdapterSession>);

impl ChatManager {
    pub async fn send_message(
        &self,
        chat_id: &str,
        content: &str,
        attachment_ids: Option<&[String]>,
        command: Option<CommandMeta>,
    ) -> Result<(), SendError> {
        let chat = self.get_chat(chat_id);
        if let Some(chat) = &chat
            && chat.worktree_missing == Some(true)
        {
            self.emit_worktree_missing_error(chat_id, chat);
            return Ok(());
        }

        self.reset_transcript_if_orphaned(chat_id, chat.as_ref())
            .await?;

        self.lifecycle.wait_for_interrupt(chat_id).await;

        if !self.session_is_spawned(chat_id) {
            self.lifecycle.start_chat(chat_id).await;
        }

        let (post, session) = self.require_live_session(chat_id)?;
        info!(chat_id, "user message sent");

        // Stamp turn start right before dispatch (for onResult turnDurationMs).
        post.lock()
            .unwrap_or_else(|e| e.into_inner())
            .turn_started_at = Some(now_ms());
        // The manager has taken ownership of this prompt — accepted whether it
        // dispatches immediately or lands behind a running turn (plan task 10;
        // `send_plain_text`/`dispatch_command` fire the matching `TurnStarted`).
        self.event_handler.notify_chat_surface(
            crate::chat_surface::ChatSurfaceEvent::TurnAccepted {
                chat_id: chat_id.to_string(),
            },
        );

        if let Some(cmd) = command {
            return self
                .dispatch_command(cmd, &post, &session, chat_id, content)
                .await;
        }
        self.send_plain_text(&post, &session, chat_id, content, attachment_ids)
            .await
    }

    fn emit_worktree_missing_error(&self, chat_id: &str, chat: &Chat) {
        let error_msg = self.messages.lock().unwrap_or_else(|e| e.into_inner())
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
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .append(chat_id, error_msg);
        self.event_handler.emit_display(chat_id);
    }

    fn session_is_spawned(&self, chat_id: &str) -> bool {
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

    fn require_live_session(&self, chat_id: &str) -> Result<LiveSession, SendError> {
        let post = self
            .get_active(chat_id)
            .ok_or_else(|| SendError(format!("Chat {chat_id} not running")))?;
        let session = {
            let guard = post.lock().unwrap_or_else(|e| e.into_inner());
            match guard.session.clone() {
                Some(s) if s.is_spawned() => s,
                _ => return Err(SendError(format!("Chat {chat_id} not running"))),
            }
        };
        Ok((post, session))
    }

    pub(super) fn set_working(&self, cell: &Arc<Mutex<ActiveChat>>, chat_id: &str, now: &str) {
        {
            let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
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

        self.queued_refs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&r.uuid);
        self.notify_queue_changed(chat_id);
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
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

        self.queued_refs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&r.uuid);
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove_by_id(chat_id, &r.message_id);
        self.notify_queue_changed(chat_id);
        self.event_handler.emit_display(chat_id);
        info!(chat_id, uuid = r.uuid, "queued message cancelled in CLI");
        Ok(())
    }

    /// How many accepted prompts are queued behind this chat's running turn.
    /// The ACP facade's prompt port reads this right after `send_message` to
    /// fill the queued-state extension metadata (spec decision 11).
    pub fn queued_message_count(&self, chat_id: &str) -> usize {
        self.queued_refs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .filter(|r| r.chat_id == chat_id)
            .count()
    }

    fn find_ref(&self, chat_id: &str, message_id: &str) -> Option<QueuedMessageRef> {
        self.queued_refs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .find(|r| r.chat_id == chat_id && r.message_id == message_id)
            .cloned()
    }
}
