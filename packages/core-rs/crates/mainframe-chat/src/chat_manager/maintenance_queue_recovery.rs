use super::*;
use mainframe_db::idle_compaction_queue::{DeliveryState, QueuedInput};
use mainframe_types::sync::LockExt as _;

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
