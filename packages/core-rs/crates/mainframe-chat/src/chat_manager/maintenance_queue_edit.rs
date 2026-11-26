use super::*;
use mainframe_db::idle_compaction_queue::{DeliveryState, QueuedInput};
use mainframe_types::sync::LockExt as _;

impl ChatManager {
    fn update_queued_ref_text(&self, uuid: &str, content: &str) {
        for r in self
            .shared
            .queued_refs
            .lock_recover()
            .iter_mut()
            .filter(|r| r.uuid == uuid)
        {
            r.content = content.to_owned();
            r.delivery = None;
        }
    }

    pub(super) async fn edit_maintenance_input(
        &self,
        chat_id: &str,
        message_id: &str,
        content: Option<&str>,
    ) -> Result<bool, SendError> {
        let _lock = self
            .handoff_locks
            .acquire(&format!("maintenance:{chat_id}"))
            .await;
        let Some(mut input) = self
            .shared
            .deps
            .idle_queue_list(chat_id)?
            .into_iter()
            .find(|input| input.message.id == message_id)
        else {
            return Ok(false);
        };
        let retry = input.delivery == DeliveryState::Rejected;
        if let Some(content) = content {
            edit_input(&mut input, content)?;
            self.shared.deps.idle_queue_put(chat_id, &input)?;
            self.shared
                .messages
                .lock_recover()
                .update_in_place(chat_id, |message| {
                    if message.id != message_id {
                        return false;
                    }
                    *message = input.message.clone();
                    true
                });
            self.update_queued_ref_text(&input.uuid, content);
        } else {
            self.dismiss_maintenance_input(chat_id, message_id, &input.uuid)?;
        }
        self.notify_queue_changed(chat_id);
        self.event_handler.emit_display(chat_id);
        if content.is_none()
            || retry
            || !self
                .get_chat(chat_id)
                .is_some_and(|chat| holds_turn_queue(&chat.adapter_id))
        {
            self.shared.schedule_maintenance_drain(chat_id);
        }
        Ok(true)
    }
    pub async fn confirm_uncertain_input(
        &self,
        chat_id: &str,
        message_id: &str,
    ) -> Result<(), SendError> {
        let lock = self
            .handoff_locks
            .acquire(&format!("maintenance:{chat_id}"))
            .await;
        let Some(input) = self
            .shared
            .deps
            .idle_queue_list(chat_id)?
            .into_iter()
            .find(|input| {
                input.message.id == message_id && input.delivery == DeliveryState::Unconfirmed
            })
        else {
            return Ok(());
        };
        if self.shared.deps.idle_queue_remove(chat_id, &input.uuid)? {
            self.remove_queued_ref(chat_id, &input.uuid);
            self.confirm_queued_message(chat_id, message_id, true);
            self.notify_queue_changed(chat_id);
            self.event_handler.emit_display(chat_id);
            drop(lock);
            self.resume_maintenance_queue(chat_id).await?;
            self.shared.schedule_maintenance_drain(chat_id);
        }
        Ok(())
    }

    pub async fn cancel_scheduled_resend(
        &self,
        chat_id: &str,
        message_id: &str,
    ) -> Result<(), SendError> {
        self.reset_scheduled_replay(chat_id, |input| input.message.id == message_id)
            .await
    }

    pub(super) async fn expire_scheduled_replay(
        &self,
        chat_id: &str,
        request_id: &str,
    ) -> Result<(), SendError> {
        self.reset_scheduled_replay(chat_id, |input| {
            input
                .message
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("queueReplay"))
                .and_then(serde_json::Value::as_str)
                == Some(request_id)
        })
        .await
    }

    async fn reset_scheduled_replay(
        &self,
        chat_id: &str,
        matches_message: impl Fn(&QueuedInput) -> bool,
    ) -> Result<(), SendError> {
        let _lock = self
            .handoff_locks
            .acquire(&format!("maintenance:{chat_id}"))
            .await;
        let Some(mut input) =
            self.shared
                .deps
                .idle_queue_list(chat_id)?
                .into_iter()
                .find(|input| {
                    input.delivery == DeliveryState::ResendScheduled && matches_message(input)
                })
        else {
            return Ok(());
        };
        input.set_delivery(DeliveryState::Unconfirmed);
        input
            .message
            .metadata
            .get_or_insert_default()
            .remove("queueReplay");
        let uuid = &input.uuid;
        if self.shared.deps.idle_queue_replace(chat_id, uuid, &input)? {
            self.refresh_replay_row(chat_id, uuid, &input);
        }
        Ok(())
    }

    pub(super) async fn prepare_scheduled_delivery(
        &self,
        chat_id: &str,
        input: &mut QueuedInput,
        session: &dyn AdapterSession,
    ) -> Result<bool, SendError> {
        if self.reconcile_queue_replay(chat_id, input, session).await? {
            return Ok(false);
        }
        self.prepare_queue_replay(chat_id, input)
    }

    async fn reconcile_queue_replay(
        &self,
        chat_id: &str,
        input: &QueuedInput,
        session: &dyn AdapterSession,
    ) -> Result<bool, SendError> {
        if !input
            .message
            .metadata
            .as_ref()
            .is_some_and(|m| m.contains_key("queueReplay"))
        {
            return Ok(false);
        }
        let Ok(history) = session.load_history().await else {
            return Ok(false);
        };
        if !history
            .iter()
            .any(|message| input.matches_provider_message(message))
        {
            return Ok(false);
        }
        if self.shared.deps.idle_queue_remove(chat_id, &input.uuid)? {
            self.remove_queued_ref(chat_id, &input.uuid);
            self.confirm_queued_message(chat_id, &input.message.id, true);
            self.notify_queue_changed(chat_id);
            self.event_handler.emit_display(chat_id);
        }
        Ok(true)
    }

    fn dismiss_maintenance_input(
        &self,
        chat_id: &str,
        message_id: &str,
        uuid: &str,
    ) -> Result<(), SendError> {
        if self.shared.deps.idle_queue_remove(chat_id, uuid)? {
            self.shared
                .messages
                .lock_recover()
                .remove_by_id(chat_id, message_id);
            self.remove_queued_ref(chat_id, uuid);
        }
        Ok(())
    }
}

fn edit_input(
    input: &mut mainframe_db::idle_compaction_queue::QueuedInput,
    content: &str,
) -> Result<(), SendError> {
    if matches!(
        input.delivery,
        DeliveryState::Unconfirmed | DeliveryState::ResendScheduled
    ) {
        return Err(AdapterError::Unavailable(
            "Delivery is uncertain. Check provider history before dismissing this queued prompt.",
        )
        .into());
    }
    input.set_delivery(DeliveryState::Pending);
    if !input.content.is_empty()
        && input.message.content.last().is_some_and(|c| {
            matches!(c,
        MessageContent::Leaf(LeafContent::Text { text, .. }) if text == &input.content)
        })
    {
        input.message.content.pop();
    }
    if !content.is_empty() {
        input
            .message
            .content
            .push(MessageContent::Leaf(LeafContent::Text {
                text: content.to_owned(),
                parent_tool_use_id: None,
            }));
    }
    input.prepared_text = match (input.text_prefix.is_empty(), content.is_empty()) {
        (true, _) => content.to_owned(),
        (false, true) => input.text_prefix.clone(),
        (false, false) => format!("{}\n\n{content}", input.text_prefix),
    };
    input.content = content.to_owned();
    Ok(())
}
