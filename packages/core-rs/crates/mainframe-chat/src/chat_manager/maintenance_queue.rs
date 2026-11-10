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
            if let Err(error) = manager.drain_maintenance_queue(&chat_id).await {
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
    pub(super) async fn enqueue_when_reserved(
        &self,
        chat_id: &str,
        content: &str,
        attachment_ids: Option<&[String]>,
        command: Option<&CommandMeta>,
    ) -> Result<bool, SendError> {
        let provider_busy = self
            .get_session_for_chat(chat_id)
            .is_some_and(|s| !s.ready_for_input());
        if !self.shared.maintenance.active(chat_id)
            && !provider_busy
            && self.shared.deps.idle_queue_list(chat_id)?.is_empty()
        {
            return Ok(false);
        }
        self.enqueue_maintenance_input(chat_id, content, attachment_ids, command.cloned())
            .await?;
        if !self.shared.maintenance.active(chat_id) && !self.session_is_spawned(chat_id) {
            self.lifecycle.start_chat(chat_id).await;
        }
        self.shared.schedule_maintenance_drain(chat_id);
        Ok(true)
    }

    pub(super) async fn enqueue_maintenance_input(
        &self,
        chat_id: &str,
        content: &str,
        attachment_ids: Option<&[String]>,
        command: Option<CommandMeta>,
    ) -> Result<(), SendError> {
        let outgoing = self
            .prepare_outgoing(chat_id, content, attachment_ids)
            .await;
        let input =
            self.build_maintenance_input(chat_id, content, attachment_ids, command, outgoing);
        let message = input.message.clone();
        let uuid = input.uuid.clone();
        self.shared.deps.idle_queue_put(chat_id, &input)?;
        self.shared
            .messages
            .lock_recover()
            .append(chat_id, message.clone());
        self.record_queued_ref(chat_id, &message, uuid, content, attachment_ids);
        self.event_handler.emit_display(chat_id);
        Ok(())
    }

    pub(super) async fn drain_maintenance_queue(&self, chat_id: &str) -> Result<(), SendError> {
        self.drain_maintenance_queue_with_wait(chat_id, std::time::Duration::from_secs(120))
            .await
    }

    pub(super) async fn drain_maintenance_queue_with_wait(
        &self,
        chat_id: &str,
        wait: std::time::Duration,
    ) -> Result<(), SendError> {
        let Ok(owner) = self
            .handoff_locks
            .get(&format!("drain:{chat_id}"))
            .try_lock_owned()
        else {
            return Ok(());
        };
        let result = self.drain_maintenance_queue_owned(chat_id, wait).await;
        drop(owner);
        if result.is_ok()
            && !self.shared.maintenance.active(chat_id)
            && self
                .get_session_for_chat(chat_id)
                .is_some_and(|s| s.ready_for_input())
            && self
                .shared
                .deps
                .idle_queue_list(chat_id)?
                .first()
                .is_some_and(|input| input.delivery == DeliveryState::Pending)
        {
            self.shared.schedule_maintenance_drain(chat_id);
        }
        result
    }

    async fn drain_maintenance_queue_owned(
        &self,
        chat_id: &str,
        wait: std::time::Duration,
    ) -> Result<(), SendError> {
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            tokio::time::timeout_at(deadline, self.lifecycle.wait_for_interrupt(chat_id))
                .await
                .map_err(|_| queue_wait_expired())?;
            let lock = self
                .handoff_locks
                .acquire(&format!("maintenance:{chat_id}"))
                .await;
            let Some(input) = self
                .shared
                .deps
                .idle_queue_list(chat_id)?
                .into_iter()
                .next()
            else {
                return Ok(());
            };
            if input.delivery != DeliveryState::Pending || self.shared.maintenance.active(chat_id) {
                return Ok(());
            }
            let (post, session) = self.require_live_session(chat_id)?;
            if !session.ready_for_input() {
                drop(lock);
                if tokio::time::Instant::now() >= deadline {
                    return Err(queue_wait_expired());
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                continue;
            }
            let _send = self.lifecycle.begin_send(chat_id).await;
            if self.shared.maintenance.active(chat_id) {
                return Ok(());
            }
            self.deliver_maintenance_input(chat_id, &post, &session, input)
                .await?;
        }
    }

    async fn deliver_maintenance_input(
        &self,
        chat_id: &str,
        post: &Arc<Mutex<ActiveChat>>,
        session: &Arc<dyn AdapterSession>,
        mut input: QueuedInput,
    ) -> Result<(), SendError> {
        self.mark_turn_accepted(post, chat_id)?;
        input.set_delivery(DeliveryState::Unconfirmed);
        self.shared.deps.idle_queue_put(chat_id, &input)?;
        self.record_message_context(post, chat_id, &input.content);
        let prior = post.lock_recover().chat.process_state.flatten();
        self.set_working(post, &now_iso8601());
        let result = super::maintenance_queue_payload::dispatch(session, &input).await;
        if let Err(error) = result {
            self.retain_failed_delivery(chat_id, post, &mut input, prior, &error)?;
            return Err(error.into());
        }
        self.shared.deps.idle_queue_remove(chat_id, &input.uuid)?;
        self.remove_queued_ref(chat_id, &input.uuid);
        self.shared
            .messages
            .lock_recover()
            .strip_queued_and_move_to_end(chat_id, &input.message.id);
        self.event_handler.emit_display(chat_id);
        self.event_handler
            .notify_chat_surface(self.shared.turn_started_event(chat_id));
        Ok(())
    }
}

fn queue_wait_expired() -> SendError {
    AdapterError::Unavailable(
        "Provider readiness timed out. Prompts remain queued; retry after checking provider state.",
    )
    .into()
}

#[cfg(test)]
#[path = "maintenance_queue_wait_tests.rs"]
mod wait_tests;
