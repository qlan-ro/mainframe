//! One handler method per `ChatSurfaceEvent` family, split out of
//! `on_chat_surface_event`'s 108-line match (todo #350, plan task 37,
//! R2.13). Pure extraction: every method still routes through
//! `for_each_attached_session`/`on_display_revision`/`push_raw_to_attached`
//! in the parent module, so the T5/T6 critical section (send inside the
//! same `locked_sessions()` guard the diff was computed under) is
//! byte-identical to before the split — nothing here takes a lock itself.

use mainframe_acp::gate_request_id;
use mainframe_chat::chat_surface::{CompactionPhase, TurnStopReason};
use mainframe_types::acp::extensions::{
    CompactionWirePhase, MAINFRAME_META_NAMESPACE, RetryMarker, UsageMeta,
};
use mainframe_types::acp::update::{StopReason, UsageUpdate};
use mainframe_types::adapter::{ContextUsage, ControlRequest};
use tracing::{debug, warn};

use super::FacadeHub;

fn stop_reason(reason: TurnStopReason) -> StopReason {
    match reason {
        TurnStopReason::Completed => StopReason::EndTurn,
        TurnStopReason::Cancelled => StopReason::Cancelled,
        TurnStopReason::Error => StopReason::Error,
    }
}

fn usage_update(usage: &ContextUsage) -> UsageUpdate {
    let meta = serde_json::json!({
        MAINFRAME_META_NAMESPACE: UsageMeta { percentage: usage.percentage }
    });
    UsageUpdate {
        used: usage.total_tokens.max(0) as u64,
        size: usage.max_tokens.max(0) as u64,
        cost: None,
        meta: Some(meta),
    }
}

impl FacadeHub {
    pub(super) fn handle_turn_started(&self, chat_id: &str) {
        self.for_each_attached_session(chat_id, |stream, now| stream.on_turn_started(now));
    }

    pub(super) fn handle_turn_finished(&self, chat_id: &str, reason: TurnStopReason) {
        self.for_each_attached_session(chat_id, |stream, now| {
            stream.on_turn_finished(stop_reason(reason), now)
        });
    }

    /// Encode only when someone is listening: this handler runs on the sink
    /// path for every chat in the daemon.
    pub(super) fn handle_display_revision(
        &self,
        chat_id: &str,
        messages: &[mainframe_types::display::DisplayMessage],
    ) {
        if self.attached_connections(chat_id).is_empty() {
            return;
        }
        let items = mainframe_acp::encoder::encode(messages);
        self.on_display_revision(chat_id, &items);
    }

    pub(super) fn handle_gate_raised(&self, chat_id: &str, request: ControlRequest) {
        let frame = mainframe_acp::build_permission_request(
            chat_id,
            gate_request_id(&request.request_id),
            &request,
        );
        let Ok(payload) = serde_json::to_string(&frame) else {
            warn!(chat_id, "acp facade: failed to serialize a gate request");
            return;
        };
        // Registration (pending-gate bookkeeping) is unconditional and
        // immediate — only the actual send rides the throttle FIFO (R2.11),
        // so a gate can never precede the tool call it belongs to on the
        // wire.
        for connection in self.attached_connections(chat_id) {
            connection.register_gate(chat_id, &request);
        }
        self.push_raw_to_attached(chat_id, payload);
    }

    pub(super) fn handle_gate_resolved(&self, chat_id: &str, request_id: &str) {
        self.locked_registry().mark_resolved(chat_id, request_id);
        let rpc_id = super::rpc_id_string(request_id);
        // A connection still holding the delivered gate did not answer it
        // (the answer path removes its own entry first) — push the
        // resolution so it clears now, not on its next resume (spec
        // criterion 8).
        let note = mainframe_acp::gate_resolved_notification(chat_id, &rpc_id);
        for entry in self.connections.iter() {
            if entry.value().remove_gate(&rpc_id).is_some() {
                entry.value().send_json(&note);
                debug!(chat_id, request_id, "acp facade: pending gate resolved");
            }
        }
    }

    pub(super) fn handle_retry(&self, chat_id: &str, attempt: i64, reason: Option<String>) {
        let marker = RetryMarker { attempt, reason };
        self.for_each_attached_session(chat_id, |stream, _now| {
            stream.on_retry(marker.clone());
            Vec::new()
        });
    }

    pub(super) fn handle_queue_changed(
        &self,
        chat_id: &str,
        refs: Vec<mainframe_types::chat::QueuedMessageRef>,
    ) {
        let note = mainframe_acp::queue_state_notification(chat_id, refs);
        if let Ok(payload) = serde_json::to_string(&note) {
            self.push_raw_to_attached(chat_id, payload);
        }
    }

    pub(super) fn handle_transcript_cleared(&self, chat_id: &str) {
        let note = mainframe_acp::transcript_cleared_notification(chat_id);
        if let Ok(payload) = serde_json::to_string(&note) {
            self.push_raw_to_attached(chat_id, payload);
        }
    }

    /// Same FIFO as content updates (T6, R2.11): a resync must not overtake
    /// the frames whose loss triggered the eviction.
    pub(super) fn handle_resync(&self, chat_id: &str) {
        let note = mainframe_acp::resync_notification(chat_id);
        if let Ok(payload) = serde_json::to_string(&note) {
            self.push_raw_to_attached(chat_id, payload);
        }
    }

    pub(super) fn handle_compaction(&self, chat_id: &str, phase: CompactionPhase) {
        let wire_phase = match phase {
            CompactionPhase::Started => CompactionWirePhase::Started,
            CompactionPhase::Done => CompactionWirePhase::Done,
        };
        let note = mainframe_acp::compaction_notification(chat_id, wire_phase);
        if let Ok(payload) = serde_json::to_string(&note) {
            self.push_raw_to_attached(chat_id, payload);
        }
    }

    pub(super) fn handle_usage(&self, chat_id: &str, usage: &ContextUsage) {
        let update = usage_update(usage);
        self.for_each_attached_session(chat_id, |stream, now| stream.on_usage(update.clone(), now));
    }

    /// Chat teardown: nothing else ever clears the gate registry's per-chat
    /// bookkeeping or a connection's per-chat session state.
    pub(super) fn handle_chat_ended(&self, chat_id: &str) {
        self.locked_registry().forget_chat(chat_id);
        for entry in self.connections.iter() {
            entry.value().forget_chat(chat_id);
        }
    }
}
