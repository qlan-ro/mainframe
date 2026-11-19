use super::*;
use mainframe_types::sync::LockExt as _;

impl ChatManager {
    pub async fn edit_queued_message(
        &self,
        chat_id: &str,
        message_id: &str,
        content: &str,
    ) -> Result<(), SendError> {
        if self
            .edit_maintenance_input(chat_id, message_id, Some(content))
            .await?
        {
            return Ok(());
        }
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

        self.shared
            .queued_refs
            .lock_recover()
            .retain(|q| q.uuid != r.uuid);
        self.notify_queue_changed(chat_id);
        self.shared
            .messages
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
        if self
            .edit_maintenance_input(chat_id, message_id, None)
            .await?
        {
            return Ok(());
        }
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

        self.shared
            .queued_refs
            .lock_recover()
            .retain(|q| q.uuid != r.uuid);
        self.shared
            .messages
            .lock_recover()
            .remove_by_id(chat_id, &r.message_id);
        self.notify_queue_changed(chat_id);
        self.event_handler.emit_display(chat_id);
        info!(chat_id, uuid = r.uuid, "queued message cancelled in CLI");
        Ok(())
    }
}
