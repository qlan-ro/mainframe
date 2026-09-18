//! Per-event fan-out: who receives a chat-surface event, and the critical
//! section it is delivered in (todo #350, T5/T6). Every event becomes one
//! [`StreamOp`], applied inside the SAME `locked_sessions()` guard it was
//! computed under (R1.2) — so a diff can never be computed under the lock
//! and enqueued after it, where a second diff for the same session could
//! interleave ahead of it — or buffered there for a resume in flight.

use std::collections::HashMap;
use std::sync::Arc;

use mainframe_acp::stream::SessionStream;
use mainframe_acp::{EncodedItem, ThrottledFrame};
use mainframe_types::adapter::ControlRequest;
use serde::Serialize;
use tracing::warn;

use super::super::facade_conn::{FacadeConnection, SessionSlot, StreamOp};
use super::{FacadeHub, now_ms};

impl FacadeHub {
    pub(super) fn attached_connections(&self, chat_id: &str) -> Vec<Arc<FacadeConnection>> {
        self.connections
            .iter()
            .filter(|entry| entry.value().is_attached(chat_id))
            .map(|entry| Arc::clone(entry.value()))
            .collect()
    }

    /// Apply one op to every attached session: through the seeded stream when
    /// there is one, or into the resume buffer when the snapshot is still in
    /// flight, for [`FacadeHub::reset_session`] to drain behind the replay.
    pub(super) fn apply_stream_op(&self, chat_id: &str, op: StreamOp) {
        let now = now_ms();
        for connection in self.attached_connections(chat_id) {
            let mut sessions = connection.locked_sessions();
            deliver_op(&connection, chat_id, &mut sessions, op.clone(), now);
        }
    }

    /// [`ChatSurfaceEvent::DisplayRevision`]'s handler. A revision buffered
    /// during a resume replaces the one already waiting: only the latest
    /// snapshot matters, and diffing it against the seed is what
    /// [`FacadeHub::reset_session`] does with it (T5, R2.9).
    pub(super) fn on_display_revision(&self, chat_id: &str, items: &[EncodedItem]) {
        self.apply_stream_op(chat_id, StreamOp::Revision(items.to_vec()));
    }

    /// Serialize one out-of-band notification and fan it out. Serializing a
    /// frame the daemon just built does not fail in practice, but dropping it
    /// silently would leave no trace of why the client never saw it.
    pub(super) fn push_notification<T: Serialize>(
        &self,
        chat_id: &str,
        note: &T,
        kind: RawFrameKind,
    ) {
        match serde_json::to_string(note) {
            Ok(payload) => self.push_raw_to_attached(chat_id, payload),
            Err(err) => warn!(
                %err,
                chat_id,
                kind = kind.label(),
                "acp facade: failed to serialize an out-of-band notification"
            ),
        }
    }

    /// Register and deliver a gate raise in one pass over one snapshot of
    /// the attached connections. Two passes let a connection that attached in
    /// between receive the request with no pending entry to correlate its
    /// answer against — the answer would then be discarded. Registration
    /// stays ahead of the send (it is unconditional and immediate; only the
    /// send rides the throttle FIFO, R2.11), just per connection now.
    pub(super) fn raise_gate(&self, chat_id: &str, request: &ControlRequest, payload: String) {
        let now = now_ms();
        let rpc_id = super::rpc_id_string(&request.request_id);
        for connection in self.attached_connections(chat_id) {
            connection.register_gate(chat_id, request);
            let mut sessions = connection.locked_sessions();
            deliver_op(
                &connection,
                chat_id,
                &mut sessions,
                StreamOp::Raw {
                    payload: payload.clone(),
                    gate_rpc_id: Some(rpc_id.clone()),
                },
                now,
            );
        }
    }

    /// A raw out-of-band notification (a gate raise, queue snapshot,
    /// transcript clear, compaction phase) — through the SAME per-session
    /// throttle FIFO content updates ride (R2.11), so it cannot arrive ahead
    /// of a still-buffered update it depends on. A gate raise goes through
    /// [`Self::raise_gate`] instead, which registers in the same pass.
    pub(super) fn push_raw_to_attached(&self, chat_id: &str, payload: String) {
        self.apply_stream_op(
            chat_id,
            StreamOp::Raw {
                payload,
                gate_rpc_id: None,
            },
        );
    }
}

/// One op against one connection's slot: applied to a seeded stream, or
/// buffered for the resume in flight. Takes the already-locked session map,
/// so a caller that must do something else under the same lock (the gate
/// raise registers before it delivers) can.
pub(super) fn deliver_op(
    connection: &FacadeConnection,
    chat_id: &str,
    sessions: &mut HashMap<String, SessionSlot>,
    op: StreamOp,
    now: i64,
) {
    match sessions.get_mut(chat_id) {
        Some(SessionSlot::Live(stream)) => {
            for frame in run_op(stream, op, now) {
                connection.send_throttled(chat_id, frame);
            }
        }
        Some(SessionSlot::AwaitingSeed { pending }) => buffer_op(pending, op),
        // The connection dropped this chat between the snapshot
        // `attached_connections` took and this lock; the op has nowhere to
        // go. /* expected */
        None => {}
    }
}

/// Buffer `op` in arrival order — except a revision, which replaces any
/// revision already waiting rather than queueing behind it.
fn buffer_op(pending: &mut Vec<StreamOp>, op: StreamOp) {
    if matches!(op, StreamOp::Revision(_))
        && let Some(slot) = pending
            .iter_mut()
            .find(|held| matches!(held, StreamOp::Revision(_)))
    {
        *slot = op;
        return;
    }
    pending.push(op);
}

/// The one interpreter for a [`StreamOp`], used live and on the resume drain.
/// A retry marker emits nothing of its own — it rides the next upsert the
/// stream produces (T16).
pub(super) fn run_op(stream: &mut SessionStream, op: StreamOp, now: i64) -> Vec<ThrottledFrame> {
    match op {
        StreamOp::Revision(items) => stream.on_revision(&items, now),
        StreamOp::Raw { payload, .. } => stream.push_raw(payload, now),
        StreamOp::TurnStarted => stream.on_turn_started(now),
        StreamOp::TurnFinished(reason) => stream.on_turn_finished(reason, now),
        StreamOp::Usage(usage) => stream.on_usage(usage, now),
        StreamOp::Retry(marker) => {
            stream.on_retry(marker);
            Vec::new()
        }
    }
}

/// Which out-of-band notification [`FacadeHub::push_notification`] is
/// carrying, for logs. A gate raise is not here: it serializes its own frame,
/// because registration has to run between the serialize and the send.
#[derive(Clone, Copy)]
pub(super) enum RawFrameKind {
    QueueState,
    TranscriptCleared,
    Resync,
    Compaction,
}

impl RawFrameKind {
    /// The frame family, for logs.
    fn label(self) -> &'static str {
        match self {
            RawFrameKind::QueueState => "queue_state",
            RawFrameKind::TranscriptCleared => "transcript_cleared",
            RawFrameKind::Resync => "resync",
            RawFrameKind::Compaction => "compaction",
        }
    }
}
