use super::*;

impl ChatManager {
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
            self.event_handler.notify_chat_surface(
                crate::chat_surface::ChatSurfaceEvent::TurnStarted {
                    chat_id: chat_id.to_string(),
                },
            );
        }
        Ok(())
    }

    pub(super) fn record_message_context(
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
