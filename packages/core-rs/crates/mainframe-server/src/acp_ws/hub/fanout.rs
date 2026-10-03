//! Per-event fan-out: who receives a chat-surface event, and the critical
//! section it is delivered in (todo #350, T5/T6). Every event becomes one
//! [`StreamOp`], applied inside the SAME `locked_sessions()` guard it was
//! computed under (R1.2) — so a diff can never be computed under the lock
//! and enqueued after it, where a second diff for the same session could
//! interleave ahead of it — or buffered there for a resume in flight.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use mainframe_acp::encoder::delta::EncodedDelta;
use mainframe_acp::stream::SessionStream;
use mainframe_acp::{EncodedItem, ThrottledFrame};
use mainframe_types::acp::extensions::RevisionCursor;
use mainframe_types::acp::jsonrpc::JsonRpcResponse;
use mainframe_types::adapter::ControlRequest;
use serde::Serialize;
use tracing::warn;

use super::super::facade_conn::{FacadeConnection, LazyFullEncoding, SessionSlot, StreamOp};
use super::{FacadeHub, now_ms};

/// What a completing `session/resume` hands [`FacadeHub::reset_session`].
pub struct ResumeSeed<'a> {
    /// The snapshot the connection's stream is re-seeded to, per container
    /// (todo #376 G4) — the same shape `ResumeReplay.containers` and
    /// `encoder::encode_containers` produce, so the freshly seeded stream's
    /// container index lines up with the next live delta's ordinals with no
    /// re-flattening.
    pub containers: &'a [Vec<EncodedItem>],
    /// The `session/resume` reply, sent ahead of the replay — and sent even
    /// when the session is gone, so the client's promise always settles.
    pub reply: &'a JsonRpcResponse,
    /// Set as `reply` goes out, in whichever arm sends it. The replay and the
    /// catch-up run behind that send, so a delivery that dies in there has
    /// already settled the client's promise and owes it no second answer.
    pub replied: Arc<AtomicBool>,
    /// Set as the `replay_complete` marker goes out, in whichever arm sends
    /// it. `fail_resume` reads this alongside `replied`: a delivery that
    /// replied but died before this was set owes the client its own
    /// `replay_complete { aborted: true }`.
    pub completed: Arc<AtomicBool>,
    /// The rpc id of the gate the replay redelivers on its own, if any.
    pub redelivered_gate: Option<&'a str>,
}

/// Replay everything buffered while the snapshot was in flight through the
/// freshly seeded `stream`, in arrival order, so each op emits the frames it
/// would have emitted live — behind the replay, never folded into it.
///
/// Two buffered gate raises are dropped instead. The one `redelivered_gate`
/// names, because the replay just sent that same request itself. And any
/// raise the connection no longer holds as pending: only
/// `handle_gate_resolved` removes a delivered gate, and it pushes
/// `gate_resolved` immediately (criterion 8) — forwarding the raise behind
/// that would leave the client a live gate the daemon has already closed.
pub(super) fn drain_into(
    stream: &mut SessionStream,
    buffered: SessionSlot,
    connection: &FacadeConnection,
    redelivered_gate: Option<&str>,
) -> Vec<ThrottledFrame> {
    let SessionSlot::AwaitingSeed { pending } = buffered else {
        return Vec::new();
    };
    let now = now_ms();
    let opted_in = connection.is_revision_cursors_opted_in();
    let mut frames = Vec::new();
    for op in pending {
        if let StreamOp::Raw {
            gate_rpc_id: Some(id),
            ..
        } = &op
            // Takes the gates lock while the sessions lock is held. Every path
            // that nests the two takes `sessions` first — the replay's
            // `deliver_gate` does too — so the order cannot cycle.
            && (Some(id.as_str()) == redelivered_gate || connection.peek_gate(id).is_none())
        {
            continue;
        }
        frames.extend(run_op(stream, op, now, opted_in));
    }
    frames
}

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
            let opted_in = connection.is_revision_cursors_opted_in();
            let mut sessions = connection.locked_sessions();
            deliver_op(
                &connection,
                chat_id,
                &mut sessions,
                op.clone(),
                now,
                opted_in,
            );
        }
    }

    /// [`ChatSurfaceEvent::DisplayRevision`]'s handler. A revision buffered
    /// during a resume merges into the one already waiting (todo #376 G4:
    /// [`EncodedDelta::merge`], "latest wins" over the union of touched
    /// ordinals) rather than replacing it outright, and applying it is what
    /// [`FacadeHub::reset_session`] does via `SessionStream::on_revision_delta`
    /// (T5, R2.9). `cursor` (todo #377) is the chat's revision-log boundary
    /// once this same revision was recorded — carried alongside the delta so
    /// a buffered catch-up frame's cursor is exactly the one the live
    /// revision would have sent.
    pub(super) fn on_display_revision(
        &self,
        chat_id: &str,
        delta: Arc<EncodedDelta>,
        full: LazyFullEncoding,
        cursor: Option<RevisionCursor>,
    ) {
        self.apply_stream_op(
            chat_id,
            StreamOp::Revision {
                delta,
                full,
                cursor,
            },
        );
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
            let opted_in = connection.is_revision_cursors_opted_in();
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
                opted_in,
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
    opted_in: bool,
) {
    match sessions.get_mut(chat_id) {
        Some(SessionSlot::Live(stream)) => {
            for frame in run_op(stream, op, now, opted_in) {
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

/// Buffer `op` in arrival order — except a revision, which MERGES into any
/// revision already waiting (todo #376 G4: `EncodedDelta::merge`) rather than
/// replacing or queueing behind it, so a container an earlier buffered delta
/// touched but a later one did not stays in the merged result. The later
/// op's `full` fallback and cursor (todo #377) win outright: `full` is never
/// forced from a buffered op regardless (the drain always hits an already-
/// seeded stream), and the cursor is the later, higher one —
/// `RevisionLog`'s monotonic revision counter guarantees that ordering.
fn buffer_op(pending: &mut Vec<StreamOp>, op: StreamOp) {
    let StreamOp::Revision {
        delta,
        full,
        cursor,
    } = op
    else {
        pending.push(op);
        return;
    };
    let Some(index) = pending
        .iter()
        .position(|held| matches!(held, StreamOp::Revision { .. }))
    else {
        pending.push(StreamOp::Revision {
            delta,
            full,
            cursor,
        });
        return;
    };
    let StreamOp::Revision { delta: base, .. } = &pending[index] else {
        unreachable!("just matched above")
    };
    let merged = Arc::new((**base).clone().merge((*delta).clone()));
    pending[index] = StreamOp::Revision {
        delta: merged,
        full,
        cursor,
    };
}

/// The one interpreter for a [`StreamOp`], used live and on the resume
/// drain. A retry marker emits nothing of its own — it rides the next
/// upsert the stream produces (T16). `opted_in` (todo #377) gates whether a
/// revision's cursor is threaded into the stream at all — a non-opted
/// connection's `Throttle` FIFO never even enqueues a `Cursor` frame, not
/// just drops it at send time (`facade_conn.rs::send_throttled`'s own
/// check is the second, defensive gate). `full` (todo #376 G4) is forced at
/// most once per `StreamOp::Revision`, shared across however many attached
/// streams call it, by the `Arc`-backed closure `handle_display_revision`
/// built.
pub(super) fn run_op(
    stream: &mut SessionStream,
    op: StreamOp,
    now: i64,
    opted_in: bool,
) -> Vec<ThrottledFrame> {
    match op {
        StreamOp::Revision {
            delta,
            full,
            cursor,
        } => stream.on_revision_delta(&delta, || full(), now, cursor.filter(|_| opted_in)),
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
