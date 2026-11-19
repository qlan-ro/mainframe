use super::*;

/// A steer's stored message plus everything `deliver_steer` needs to deliver
/// it or roll it back.
pub(super) struct SteerMessage<'a> {
    pub(super) chat_id: &'a str,
    pub(super) content: &'a str,
    pub(super) attachment_ids: Option<&'a [String]>,
    pub(super) message: ChatMessage,
    pub(super) message_uuid: String,
    pub(super) is_queued: bool,
    pub(super) text: String,
}

impl ChatManager {
    /// The adapter refused a turn before it started (for example Codex
    /// rejecting `thread/resume` for a thread archived outside Mainframe).
    /// No result will ever arrive to clear the working state `set_working`
    /// stamped, so restore the state the chat had before the send. Drop the
    /// stored message too: the caller's error is what the client shows, as a
    /// failed optimistic send it can retry, and a stored copy would duplicate it.
    pub(in crate::chat_manager) fn roll_back_refused_turn(
        &self,
        post: &Arc<Mutex<ActiveChat>>,
        chat_id: &str,
        message: &ChatMessage,
        prior_state: Option<ProcessState>,
        err: &mainframe_adapter_api::AdapterError,
    ) {
        tracing::warn!(chat_id, error = %err, "adapter refused the turn");
        self.shared
            .messages
            .lock_recover()
            .remove_by_id(chat_id, &message.id);
        self.event_handler.emit_display(chat_id);
        let update = self.shared.prepare_live_update(
            chat_id,
            &ChatPatch {
                process_state: Some(prior_state),
                ..Default::default()
            },
        );
        let chat = {
            let mut guard = post.lock_recover();
            guard.chat.process_state = Some(prior_state);
            guard.chat.clone()
        };
        update.emit(chat, None);
    }

    pub(super) async fn deliver_steer(
        &self,
        post: &Arc<Mutex<ActiveChat>>,
        session: &Arc<dyn AdapterSession>,
        pending: SteerMessage<'_>,
    ) -> Result<(), SendError> {
        let SteerMessage {
            chat_id,
            content,
            attachment_ids,
            message,
            message_uuid,
            is_queued,
            text,
        } = pending;
        // Claude's steer is also a queued send when replay-ack
        // applies (`queued_message_metadata`): the running
        // transition is reported once, on the ack, not here too.
        if is_queued {
            self.record_queued_ref(
                chat_id,
                &message,
                message_uuid.clone(),
                content,
                attachment_ids,
            );
        }
        if let Err(err) = session.steer(text, Some(message_uuid.clone())).await {
            if is_queued {
                self.remove_queued_ref(chat_id, &message_uuid);
            }
            self.shared
                .messages
                .lock_recover()
                .remove_by_id(chat_id, &message.id);
            self.event_handler.emit_display(chat_id);
            return Err(err.into());
        }
        self.record_message_context(post, chat_id, content);
        if !is_queued {
            self.event_handler
                .notify_chat_surface(self.shared.turn_started_event(chat_id));
        }
        Ok(())
    }

    pub(in crate::chat_manager) fn record_message_context(
        &self,
        post: &Arc<Mutex<ActiveChat>>,
        chat_id: &str,
        content: &str,
    ) {
        if self.shared.best_effort(
            chat_id,
            self.shared
                .deps
                .extract_mentions_from_text(chat_id, content),
            false,
        ) {
            self.emit(DaemonEvent::ContextUpdated {
                chat_id: chat_id.to_string(),
                file_paths: None,
            });
        }
        self.assign_initial_title(post, chat_id, content);
    }
}
