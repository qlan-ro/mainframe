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
        let _queue_control = self
            .handoff_locks
            .acquire(&format!("queue-control:{chat_id}"))
            .await;
        self.lifecycle.wait_for_interrupt(chat_id).await;
        self.lifecycle.finish_closing_session(chat_id).await?;
        let _lock = self
            .handoff_locks
            .acquire(&format!("maintenance:{chat_id}"))
            .await;
        self.shared.restore_queue_pause(chat_id)?;
        let dashmap::mapref::entry::Entry::Occupied(pause) =
            self.shared.queue_pauses.entry(chat_id.to_owned())
        else {
            return Ok(());
        };
        if self
            .shared
            .deps
            .idle_queue_list(chat_id)?
            .first()
            .is_some_and(|input| {
                input.delivery == mainframe_db::idle_compaction_queue::DeliveryState::Unconfirmed
            })
        {
            return Ok(());
        }
        self.shared.deps.idle_queue_set_pause(chat_id, None)?;
        pause.remove();
        self.notify_queue_changed(chat_id);
        if self.get_queued_for_chat(chat_id).is_empty() {
            return Ok(());
        }
        if !self.session_is_spawned(chat_id) {
            self.lifecycle.start_chat(chat_id).await;
        }
        self.shared.schedule_maintenance_drain(chat_id);
        Ok(())
    }
}

#[cfg(test)]
#[path = "maintenance_queue_pause_tests.rs"]
mod tests;
