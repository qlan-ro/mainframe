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

fn queue_wait_expired() -> SendError {
    AdapterError::Unavailable(
        "Provider readiness timed out. Prompts remain queued; retry after checking provider state.",
    )
    .into()
}

#[cfg(test)]
#[path = "maintenance_queue_recovery_tests.rs"]
mod tests;
