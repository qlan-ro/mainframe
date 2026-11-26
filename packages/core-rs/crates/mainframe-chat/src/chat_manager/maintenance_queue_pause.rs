use super::*;

impl ChatShared {
    pub(crate) fn restore_queue_pause(&self, chat_id: &str) -> Result<(), AdapterError> {
        if let dashmap::mapref::entry::Entry::Vacant(entry) =
            self.queue_pauses.entry(chat_id.to_owned())
            && let Some(reason) = self
                .deps
                .idle_queue_pause_reason(chat_id)
                .map_err(|_| AdapterError::Message("Queue pause unavailable".into()))?
        {
            entry.insert(reason);
        }
        Ok(())
    }

    pub(crate) fn pause_maintenance_queue(&self, chat_id: &str, reason: &str) -> bool {
        use dashmap::mapref::entry::Entry;
        let persist = || {
            if self
                .deps
                .idle_queue_set_pause(chat_id, Some(reason))
                .is_err()
            {
                tracing::warn!(chat_id, "queue pause persistence failed");
            }
        };
        match self.queue_pauses.entry(chat_id.to_owned()) {
            Entry::Occupied(mut entry) if reason == "Stopped" => {
                entry.insert(reason.to_owned());
                persist();
                true
            }
            Entry::Occupied(_) => false,
            Entry::Vacant(entry) => {
                let _pause = entry.insert(reason.to_owned());
                persist();
                true
            }
        }
    }
}

impl ChatManager {
    pub async fn resume_maintenance_queue(&self, chat_id: &str) -> Result<(), SendError> {
        self.lifecycle.wait_for_interrupt(chat_id).await;
        self.lifecycle.finish_closing_session(chat_id).await?;
        let _lock = self
            .handoff_locks
            .acquire(&format!("maintenance:{chat_id}"))
            .await;
        let _queue_control = self
            .handoff_locks
            .acquire(&format!("queue-control:{chat_id}"))
            .await;
        self.shared.restore_queue_pause(chat_id)?;
        if !self.shared.queue_pauses.contains_key(chat_id) {
            return Ok(());
        }
        let head = self
            .shared
            .deps
            .idle_queue_list(chat_id)?
            .into_iter()
            .next();
        if let Some(head) = &head {
            if !head.delivery.ready_to_dispatch() {
                return Ok(());
            }
            if !self.session_is_spawned(chat_id) {
                self.lifecycle.start_chat(chat_id).await;
            }
            let (_, session) = self.require_live_session(chat_id)?;
            if !session.ready_for_input() {
                return Err(AdapterError::Unavailable(
                    "The provider is not ready to resume the queue.",
                )
                .into());
            }
        }
        let dashmap::mapref::entry::Entry::Occupied(pause) =
            self.shared.queue_pauses.entry(chat_id.to_owned())
        else {
            return Ok(());
        };
        self.shared.deps.idle_queue_set_pause(chat_id, None)?;
        pause.remove();
        self.notify_queue_changed(chat_id);
        if head.is_some() {
            self.shared.schedule_maintenance_drain(chat_id);
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "maintenance_queue_pause_tests.rs"]
mod tests;
