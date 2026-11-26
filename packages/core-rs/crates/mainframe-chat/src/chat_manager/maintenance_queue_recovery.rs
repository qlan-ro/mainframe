use super::*;
use mainframe_db::idle_compaction_queue::{DeliveryState, QueuedInput};
use mainframe_types::sync::LockExt as _;

impl ChatShared {
    pub(crate) fn schedule_maintenance_drain(&self, chat_id: &str) {
        let Some(manager) = self.manager.get().and_then(|m| m.upgrade()) else {
            return;
        };
        let chat_id = chat_id.to_owned();
        tokio::spawn(async move {
            if let Err(error) = manager.drain_scheduled_queue(&chat_id).await {
                tracing::warn!(chat_id, "maintenance queue delivery failed");
                manager.emit(DaemonEvent::Error {
                    chat_id: Some(chat_id),
                    error: error.to_string(),
                });
            }
        });
    }
}

impl ChatManager {
    pub(super) fn retain_failed_delivery(
        &self,
        chat_id: &str,
        post: &Arc<Mutex<ActiveChat>>,
        input: &mut QueuedInput,
        prior: Option<ProcessState>,
        error: &AdapterError,
    ) -> Result<(), SendError> {
        if matches!(
            error,
            AdapterError::DeliveryRejected(_)
                | AdapterError::NotSpawned(_)
                | AdapterError::StdinFull(_)
        ) {
            input.set_delivery(DeliveryState::Rejected);
            self.shared.deps.idle_queue_put(chat_id, input)?;
        }
        self.roll_back_refused_turn(post, chat_id, &input.message, prior, error);
        self.shared
            .messages
            .lock_recover()
            .append(chat_id, input.message.clone());
        for queued in self
            .shared
            .queued_refs
            .lock_recover()
            .iter_mut()
            .filter(|r| r.uuid == input.uuid)
        {
            queued.delivery = input.delivery.recovery_label();
        }
        self.notify_queue_changed(chat_id);
        self.event_handler.emit_display(chat_id);
        Ok(())
    }
}

impl ChatShared {
    pub(crate) fn expose_uncertain_delivery(&self, chat_id: &str, uuid: Option<&str>) -> bool {
        let Ok(inputs) = self.deps.idle_queue_list(chat_id) else {
            return false;
        };
        let mut changed = false;
        let mut refs = self.queued_refs.lock_recover();
        for input in inputs {
            if input.delivery != DeliveryState::Unconfirmed
                || uuid.is_some_and(|id| id != input.uuid)
            {
                continue;
            }
            if let Some(row) = refs.iter_mut().find(|row| row.uuid == input.uuid) {
                let label = input.delivery.recovery_label();
                changed |= row.delivery != label;
                row.delivery = label;
            }
        }
        changed
    }

    fn schedule_resend_timeout(&self, chat_id: &str, request_id: String) {
        let Some(manager) = self.manager.get().cloned() else {
            return;
        };
        let chat_id = chat_id.to_owned();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
        tokio::spawn(async move {
            tokio::time::sleep_until(deadline).await;
            if let Some(manager) = manager.upgrade()
                && let Err(error) = manager.expire_scheduled_replay(&chat_id, &request_id).await
            {
                tracing::warn!(chat_id, %error, "resend timeout failed");
            }
        });
    }

    pub(super) fn schedule_queue_echo_timeout(&self, chat_id: &str, uuid: String) {
        let Some(manager) = self.manager.get().and_then(|m| m.upgrade()) else {
            return;
        };
        let manager = Arc::downgrade(&manager);
        let chat_id = chat_id.to_owned();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
        tokio::spawn(async move {
            tokio::time::sleep_until(deadline).await;
            if let Some(manager) = manager.upgrade()
                && manager
                    .shared
                    .expose_uncertain_delivery(&chat_id, Some(&uuid))
            {
                manager.notify_queue_changed(&chat_id);
            }
        });
    }
}

impl ChatManager {
    pub(super) async fn wait_for_queue_interrupt(
        &self,
        chat_id: &str,
        deadline: tokio::time::Instant,
    ) -> Result<(), SendError> {
        tokio::time::timeout_at(deadline, self.lifecycle.wait_for_interrupt(chat_id))
            .await
            .map_err(|_| {
                self.pause_failed_drain(chat_id);
                queue_wait_expired()
            })
    }

    pub(super) async fn wait_for_queue_readiness(
        &self,
        chat_id: &str,
        deadline: tokio::time::Instant,
    ) -> Result<(), SendError> {
        if tokio::time::Instant::now() >= deadline {
            self.pause_failed_drain(chat_id);
            return Err(queue_wait_expired());
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        Ok(())
    }

    pub(super) fn pause_failed_drain(&self, chat_id: &str) {
        if self
            .shared
            .pause_maintenance_queue(chat_id, "Provider unavailable")
        {
            self.notify_queue_changed(chat_id);
        }
    }
}

impl ChatManager {
    pub async fn replay_uncertain_input(
        &self,
        chat_id: &str,
        message_id: &str,
    ) -> Result<(), SendError> {
        let lock = self
            .handoff_locks
            .acquire(&format!("maintenance:{chat_id}"))
            .await;
        let Some(mut input) = self
            .shared
            .deps
            .idle_queue_list(chat_id)?
            .into_iter()
            .next()
            .filter(|input| {
                input.message.id == message_id && input.delivery == DeliveryState::Unconfirmed
            })
        else {
            return Ok(());
        };
        if !self
            .get_queued_for_chat(chat_id)
            .iter()
            .any(|row| row.uuid == input.uuid && row.delivery.as_deref() == Some("unconfirmed"))
        {
            return Ok(());
        }
        input.set_delivery(DeliveryState::ResendScheduled);
        let request_id = nanoid::nanoid!();
        input
            .message
            .metadata
            .get_or_insert_default()
            .insert("queueReplay".into(), serde_json::json!(request_id));
        if !self
            .shared
            .deps
            .idle_queue_replace(chat_id, &input.uuid, &input)?
        {
            return Ok(());
        }
        self.refresh_replay_row(chat_id, &input.uuid, &input);
        self.shared.schedule_resend_timeout(chat_id, request_id);
        drop(lock);
        self.resume_maintenance_queue(chat_id).await?;
        self.shared.schedule_maintenance_drain(chat_id);
        Ok(())
    }

    pub(super) fn prepare_queue_replay(
        &self,
        chat_id: &str,
        input: &mut QueuedInput,
    ) -> Result<bool, SendError> {
        let metadata = input.message.metadata.get_or_insert_default();
        if metadata.remove("queueReplay").is_none() {
            return Ok(true);
        }
        let previous = std::mem::replace(&mut input.uuid, nanoid::nanoid!());
        let mut previous_uuids = match metadata.remove("queuePreviousUuids") {
            Some(serde_json::Value::Array(ids)) => ids,
            _ => Vec::new(),
        };
        previous_uuids.push(serde_json::json!(previous));
        metadata.insert(
            "queuePreviousUuids".into(),
            serde_json::Value::Array(previous_uuids),
        );
        metadata.insert("uuid".into(), serde_json::json!(input.uuid));
        if !self
            .shared
            .deps
            .idle_queue_replace(chat_id, &previous, input)?
        {
            return Ok(false);
        }
        self.refresh_replay_row(chat_id, &previous, input);
        Ok(true)
    }

    pub(super) fn refresh_replay_row(&self, chat_id: &str, previous: &str, input: &QueuedInput) {
        self.shared
            .messages
            .lock_recover()
            .update_in_place(chat_id, |message| {
                if message.id != input.message.id
                    || message
                        .metadata
                        .as_ref()
                        .and_then(|m| m.get("uuid"))
                        .and_then(serde_json::Value::as_str)
                        != Some(previous)
                {
                    return false;
                }
                *message = input.message.clone();
                true
            });
        for row in self
            .shared
            .queued_refs
            .lock_recover()
            .iter_mut()
            .filter(|row| row.uuid == previous)
        {
            *row = input.queued_ref(chat_id);
        }
        self.notify_queue_changed(chat_id);
        self.event_handler.emit_display(chat_id);
    }
}

fn queue_wait_expired() -> SendError {
    AdapterError::Unavailable(
        "Provider readiness timed out. Prompts remain queued; retry after checking provider state.",
    )
    .into()
}

#[cfg(test)]
#[path = "maintenance_queue_recovery_tests.rs"]
mod tests;
