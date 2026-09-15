//! The `ChatSurface` sink: `on_chat_surface_event`'s dispatch match and one
//! handler method per event family (todo #350, plan task 37, R2.13). Every
//! method routes through `fanout.rs`, which owns the T5/T6 critical section
//! — nothing here takes a lock itself.

use mainframe_acp::gate_request_id;
use mainframe_chat::chat_surface::{
    ChatSurface, ChatSurfaceEvent, CompactionPhase, TurnStopReason,
};
use mainframe_types::acp::extensions::{
    CompactionWirePhase, MAINFRAME_META_NAMESPACE, RetryMarker, UsageMeta,
};
use mainframe_types::acp::update::{StopReason, UsageUpdate};
use mainframe_types::adapter::{ContextUsage, ControlRequest};
use tracing::{debug, warn};

use super::super::facade_conn::StreamOp;
use super::FacadeHub;
use super::fanout::RawFrameKind;

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
        self.apply_stream_op(chat_id, StreamOp::TurnStarted);
    }

    pub(super) fn handle_turn_finished(&self, chat_id: &str, reason: TurnStopReason) {
        self.apply_stream_op(chat_id, StreamOp::TurnFinished(stop_reason(reason)));
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
        self.raise_gate(chat_id, &request, payload);
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
        self.apply_stream_op(chat_id, StreamOp::Retry(RetryMarker { attempt, reason }));
    }

    pub(super) fn handle_queue_changed(
        &self,
        chat_id: &str,
        refs: Vec<mainframe_types::chat::QueuedMessageRef>,
    ) {
        let note = mainframe_acp::queue_state_notification(chat_id, refs);
        self.push_notification(chat_id, &note, RawFrameKind::QueueState);
    }

    pub(super) fn handle_transcript_cleared(&self, chat_id: &str) {
        let note = mainframe_acp::transcript_cleared_notification(chat_id);
        self.push_notification(chat_id, &note, RawFrameKind::TranscriptCleared);
    }

    /// Same FIFO as content updates (T6, R2.11): a resync must not overtake
    /// the frames whose loss triggered the eviction.
    pub(super) fn handle_resync(&self, chat_id: &str) {
        let note = mainframe_acp::resync_notification(chat_id);
        self.push_notification(chat_id, &note, RawFrameKind::Resync);
    }

    pub(super) fn handle_compaction(&self, chat_id: &str, phase: CompactionPhase) {
        let wire_phase = match phase {
            CompactionPhase::Started => CompactionWirePhase::Started,
            CompactionPhase::Done => CompactionWirePhase::Done,
        };
        let note = mainframe_acp::compaction_notification(chat_id, wire_phase);
        self.push_notification(chat_id, &note, RawFrameKind::Compaction);
    }

    pub(super) fn handle_usage(&self, chat_id: &str, usage: &ContextUsage) {
        self.apply_stream_op(chat_id, StreamOp::Usage(usage_update(usage)));
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

/// Dispatch only: every arm delegates to one of the handlers above.
impl ChatSurface for FacadeHub {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        match event {
            // Acceptance already rides the `session/prompt` response
            // (`PromptResponse` + queued `_meta`), not a stream frame.
            ChatSurfaceEvent::TurnAccepted { .. } => {}
            ChatSurfaceEvent::TurnStarted { chat_id } => self.handle_turn_started(&chat_id),
            ChatSurfaceEvent::TurnFinished {
                chat_id,
                stop_reason: reason,
            } => self.handle_turn_finished(&chat_id, reason),
            ChatSurfaceEvent::DisplayRevision { chat_id, messages } => {
                self.handle_display_revision(&chat_id, &messages);
            }
            ChatSurfaceEvent::GateRaised { chat_id, request } => {
                self.handle_gate_raised(&chat_id, request);
            }
            ChatSurfaceEvent::GateResolved {
                chat_id,
                request_id,
            } => self.handle_gate_resolved(&chat_id, &request_id),
            ChatSurfaceEvent::Retry {
                chat_id,
                attempt,
                reason,
            } => self.handle_retry(&chat_id, attempt, reason),
            ChatSurfaceEvent::QueueChanged { chat_id, refs } => {
                self.handle_queue_changed(&chat_id, refs);
            }
            ChatSurfaceEvent::TranscriptCleared { chat_id } => {
                self.handle_transcript_cleared(&chat_id);
            }
            ChatSurfaceEvent::Resync { chat_id } => self.handle_resync(&chat_id),
            ChatSurfaceEvent::Compaction { chat_id, phase } => {
                self.handle_compaction(&chat_id, phase);
            }
            ChatSurfaceEvent::Usage { chat_id, usage } => self.handle_usage(&chat_id, &usage),
            ChatSurfaceEvent::ChatEnded { chat_id } => self.handle_chat_ended(&chat_id),
        }
    }
}
