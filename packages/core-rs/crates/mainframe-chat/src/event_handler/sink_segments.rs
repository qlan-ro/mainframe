//! Per-segment bookkeeping at a turn's result: the active segment's counters,
//! and delivery of its pending handoff (the provider recorded the message
//! that carried the block, interrupted or not).

use mainframe_types::segment::{HandoffStatus, SegmentResultDelta};

use super::*;
use crate::segments::divider::{is_divider, refresh_divider};

impl<D: EventHandlerDeps + 'static> SessionSinkImpl<D> {
    pub(super) fn record_segment_result(&self, data: &SessionResult) {
        let Some(store) = self.deps.segment_store() else {
            return;
        };
        let (first_message_id, last_message_id) = self.turn_message_ids();
        let usage = data.usage.as_ref();
        store.add_result(
            &self.chat_id,
            &SegmentResultDelta {
                cost: data.total_cost_usd.unwrap_or(0.0),
                tokens_input: usage.and_then(|u| u.input_tokens).unwrap_or(0),
                tokens_output: usage.and_then(|u| u.output_tokens).unwrap_or(0),
                first_message_id,
                last_message_id,
            },
        );
        let Some(layout) = store.layout(&self.chat_id) else {
            return;
        };
        let Some(active) = layout.active() else {
            return;
        };
        let pending = layout
            .handoff_for(&active.id)
            .filter(|h| h.status == HandoffStatus::Pending);
        let Some(pending) = pending else {
            return;
        };
        store.set_handoff_status(&pending.id, HandoffStatus::Delivered);
        let name_of = |id: &str| self.deps.adapter_name(id);
        if refresh_divider(&self.messages, store, &self.chat_id, &active.id, &name_of) {
            self.emit_display();
        }
    }

    /// The turn's user message (the latest one) and its last message.
    fn turn_message_ids(&self) -> (Option<String>, Option<String>) {
        let messages = self.messages.lock().unwrap_or_else(|e| e.into_inner());
        let Some(list) = messages.get(&self.chat_id) else {
            return (None, None);
        };
        let first = list
            .iter()
            .rev()
            .find(|m| m.r#type == ChatMessageType::User)
            .map(|m| m.id.clone());
        let last = list
            .iter()
            .rev()
            .find(|m| !is_divider(m))
            .map(|m| m.id.clone());
        (first, last)
    }
}
