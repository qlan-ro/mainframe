use super::*;
use mainframe_db::idle_compaction_queue::{DeliveryState, QueuedInput};
use mainframe_types::sync::LockExt as _;

impl ChatManager {
    pub(super) fn held_queue_turn_running(&self, chat_id: &str) -> bool {
        self.get_active(chat_id).is_some_and(|cell| {
            let active = cell.lock_recover();
            active
                .session
                .as_ref()
                .is_some_and(|session| holds_turn_queue(session.adapter_id()))
                && is_working(&active.chat)
        })
    }

    /// Whether maintenance owns the chat's input right now, so a message has to
    /// wait its turn behind it.
    pub(super) fn input_reserved(&self, chat_id: &str) -> Result<bool, SendError> {
        let provider_busy = self
            .get_session_for_chat(chat_id)
            .is_some_and(|s| !s.ready_for_input());
        Ok(self.shared.maintenance.active(chat_id)
            || provider_busy
            || !self.shared.deps.idle_queue_list(chat_id)?.is_empty())
    }

    pub(super) async fn enqueue_when_reserved(
        &self,
        chat_id: &str,
        content: &str,
        attachment_ids: Option<&[String]>,
        command: Option<&CommandMeta>,
    ) -> Result<Option<String>, SendError> {
        self.shared.restore_queue_pause(chat_id)?;
        if self.shared.queue_pauses.contains_key(chat_id)
            && !self.shared.maintenance.active(chat_id)
            && !self.held_queue_turn_running(chat_id)
        {
            return Ok(None);
        }
        let running = self.held_queue_turn_running(chat_id);
        if !running && !self.input_reserved(chat_id)? {
            return Ok(None);
        }
        let message_id = self
            .enqueue_maintenance_input(chat_id, content, attachment_ids, command.cloned())
            .await?;
        if !self.shared.maintenance.active(chat_id) && !self.session_is_spawned(chat_id) {
            self.lifecycle.start_chat(chat_id).await;
        }
        if !running {
            self.shared.schedule_maintenance_drain(chat_id);
        }
        Ok(Some(message_id))
    }

    pub(super) async fn enqueue_maintenance_input(
        &self,
        chat_id: &str,
        content: &str,
        attachment_ids: Option<&[String]>,
        command: Option<CommandMeta>,
    ) -> Result<String, SendError> {
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
        Ok(message.id)
    }

    #[cfg(test)]
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
            && !self.shared.queue_pauses.contains_key(chat_id)
            && !self.shared.maintenance.active(chat_id)
            && self
                .get_session_for_chat(chat_id)
                .is_some_and(|s| s.ready_for_input())
            && self
                .shared
                .deps
                .idle_queue_list(chat_id)?
                .first()
                .is_some_and(|input| input.delivery.ready_to_dispatch())
        {
            self.shared.schedule_maintenance_drain(chat_id);
        }
        result
    }

    pub(super) async fn drain_scheduled_queue(&self, chat_id: &str) -> Result<(), SendError> {
        let wait = std::time::Duration::from_secs(120);
        if !self
            .get_chat(chat_id)
            .is_some_and(|chat| holds_turn_queue(&chat.adapter_id))
        {
            return self.drain_maintenance_queue_with_wait(chat_id, wait).await;
        }
        let _owner = self
            .handoff_locks
            .acquire(&format!("drain:{chat_id}"))
            .await;
        self.drain_maintenance_queue_owned(chat_id, wait).await
    }

    async fn drain_maintenance_queue_owned(
        &self,
        chat_id: &str,
        wait: std::time::Duration,
    ) -> Result<(), SendError> {
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            self.wait_for_queue_interrupt(chat_id, deadline).await?;
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
            else {
                return Ok(());
            };
            if !input.delivery.ready_to_dispatch()
                || self.shared.queue_pauses.contains_key(chat_id)
                || self.shared.maintenance.active(chat_id)
            {
                return Ok(());
            }
            let Some((post, session)) = self.queue_session(chat_id)? else {
                return Ok(());
            };
            if !session.ready_for_input() {
                drop(lock);
                self.wait_for_queue_readiness(chat_id, deadline).await?;
                continue;
            }
            let _send = self.lifecycle.begin_send(chat_id).await;
            if self.shared.maintenance.active(chat_id)
                || self.shared.queue_pauses.contains_key(chat_id)
            {
                return Ok(());
            }
            if !self
                .prepare_scheduled_delivery(chat_id, &mut input, session.as_ref())
                .await?
            {
                continue;
            }
            self.deliver_maintenance_input(chat_id, &post, &session, input)
                .await?;
            if holds_turn_queue(session.adapter_id()) {
                return Ok(());
            }
        }
    }

    fn queue_session(
        &self,
        chat_id: &str,
    ) -> Result<Option<super::send_entry::LiveSession>, SendError> {
        if self.held_queue_turn_running(chat_id) {
            return Ok(None);
        }
        self.require_live_session(chat_id)
            .map(Some)
            .inspect_err(|_| {
                self.pause_failed_drain(chat_id);
            })
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
        if !self
            .shared
            .deps
            .idle_queue_replace(chat_id, &input.uuid, &input)?
        {
            return Ok(());
        }
        self.record_message_context(post, chat_id, &input.content);
        let prior = post.lock_recover().chat.process_state.flatten();
        if !self.guard_resend_write(chat_id, post, session.as_ref(), &input) {
            self.set_working(post, &now_iso8601());
        }
        let held_queue = holds_turn_queue(session.adapter_id());
        if held_queue {
            self.shared
                .messages
                .lock_recover()
                .move_to_end(chat_id, &input.message.id);
        }
        let waits_for_echo = session.acknowledges_queued_input_by_echo();
        if waits_for_echo {
            self.shared
                .active_queue_echoes
                .insert(chat_id.to_owned(), input.uuid.clone());
        }
        let result = super::maintenance_queue_payload::dispatch(session, &input).await;
        if let Err(error) = result {
            session.clear_queued_write_guard(&input.uuid);
            self.shared
                .active_queue_echoes
                .remove_if(chat_id, |_, uuid| uuid == &input.uuid);
            self.retain_failed_delivery(chat_id, post, &mut input, prior, &error)?;
            return Err(error.into());
        }
        if waits_for_echo {
            self.shared.schedule_queue_echo_timeout(chat_id, input.uuid);
            return Ok(());
        }
        self.finish_queue_dispatch(chat_id, &input, held_queue)
    }

    fn finish_queue_dispatch(
        &self,
        chat_id: &str,
        input: &QueuedInput,
        held_queue: bool,
    ) -> Result<(), SendError> {
        self.shared.deps.idle_queue_remove(chat_id, &input.uuid)?;
        self.remove_queued_ref(chat_id, &input.uuid);
        self.confirm_queued_message(chat_id, &input.message.id, held_queue);
        self.event_handler.emit_display(chat_id);
        self.event_handler
            .notify_chat_surface(self.shared.turn_started_event(chat_id));
        Ok(())
    }
    pub(super) fn confirm_queued_message(&self, chat_id: &str, id: &str, held_queue: bool) {
        let mut messages = self.shared.messages.lock_recover();
        if !held_queue {
            messages.strip_queued_and_move_to_end(chat_id, id);
            return;
        }
        messages.update_in_place(chat_id, |msg| {
            if msg.id != id {
                return false;
            }
            let Some(meta) = msg.metadata.as_mut() else {
                return false;
            };
            meta.remove("uuid");
            meta.remove("queueDelivery");
            meta.remove("queueReplay");
            meta.remove("queued").is_some()
        });
    }
}

#[cfg(test)]
#[path = "maintenance_queue_wait_tests.rs"]
pub(super) mod wait_tests;
