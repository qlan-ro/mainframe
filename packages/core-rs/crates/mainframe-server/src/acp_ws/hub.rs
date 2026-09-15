//! The facade hub — the live assembly point between the chat-surface seam
//! (`mainframe_chat::chat_surface`) and the `/acp/{profile}` connections
//! (todo #350, live-wiring pass). One `FacadeHub` exists per daemon, attached
//! to the `ChatManager` at boot (`build_chat_manager`); it fans every
//! chat-surface event out to the connections attached to that chat, with the
//! per-session encode → diff → throttle pipeline delegated to the pure
//! `mainframe_acp::SessionStream`. This file owns the connection registry
//! and the resume seed/teardown lifecycle; `fanout.rs` owns per-event
//! delivery and `handlers.rs` the `ChatSurface` sink itself.

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use mainframe_acp::stream::SessionStream;
use mainframe_acp::{AnswerOutcome, EncodedItem, GateRegistry, ThrottledFrame};
use mainframe_chat::chat_surface::ChatSurface;
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, JsonRpcResponse};
use mainframe_types::adapter::ControlRequest;
use tokio::sync::mpsc;
use tracing::debug;

use super::facade_conn::{FacadeConnection, SessionSlot, StreamOp, rpc_id_string};

mod fanout;
mod handlers;

/// Coalescing window for chunk fan-out (spec decision 14) and the cadence of
/// each connection's flush tick — an implementation choice per the spec; the
/// no-full-resend guarantee itself lives in `SessionState`, not here.
pub const FACADE_THROTTLE_INTERVAL_MS: i64 = 100;

pub struct FacadeHub {
    connections: DashMap<String, Arc<FacadeConnection>>,
    gates: Mutex<GateRegistry>,
    throttle_interval_ms: i64,
}

impl Default for FacadeHub {
    fn default() -> Self {
        Self::new(FACADE_THROTTLE_INTERVAL_MS)
    }
}

impl FacadeHub {
    pub fn new(throttle_interval_ms: i64) -> Self {
        Self {
            connections: DashMap::new(),
            gates: Mutex::new(GateRegistry::new()),
            throttle_interval_ms,
        }
    }

    pub fn register(
        &self,
        profile: String,
    ) -> (
        String,
        Arc<FacadeConnection>,
        mpsc::UnboundedReceiver<String>,
    ) {
        let (tx, rx) = mpsc::unbounded_channel();
        let connection = Arc::new(FacadeConnection::new(profile, tx));
        let client_id = nanoid::nanoid!();
        self.connections
            .insert(client_id.clone(), Arc::clone(&connection));
        (client_id, connection, rx)
    }

    pub fn unregister(&self, client_id: &str) {
        self.connections.remove(client_id);
    }

    pub fn connection_count(&self) -> usize {
        self.connections.len()
    }

    /// The `ChatSurface` upcast `build_chat_manager` wants — here so the
    /// daemon boot doesn't need `mainframe-chat` as a direct dependency just
    /// to name the trait.
    pub fn as_chat_surface(self: &Arc<Self>) -> Arc<dyn ChatSurface> {
        Arc::clone(self) as Arc<dyn ChatSurface>
    }

    /// Attach `connection` to `chat_id` with a fresh stream (prompt path —
    /// the resume path seeds through [`Self::reset_session`] instead). A
    /// no-op when already attached (`Live` or `AwaitingSeed`).
    pub fn attach(&self, connection: &FacadeConnection, chat_id: &str) {
        connection
            .locked_sessions()
            .entry(chat_id.to_string())
            .or_insert_with(|| SessionSlot::Live(SessionStream::new(self.throttle_interval_ms)));
    }

    /// Mark `chat_id` as awaiting a resume snapshot, before that snapshot is
    /// awaited (T5, R2.9): a live revision racing the await has nothing
    /// seeded to diff against, so [`Self::on_chat_surface_event`] buffers its
    /// item snapshot here instead of dropping it. Unconditional — a resume
    /// always ends by fully reseeding via [`Self::reset_session`], so
    /// discarding any prior `Live` state (or an overlapping earlier await)
    /// is safe.
    pub fn begin_resume(&self, connection: &FacadeConnection, chat_id: &str) {
        connection.locked_sessions().insert(
            chat_id.to_string(),
            SessionSlot::AwaitingSeed {
                pending: Vec::new(),
            },
        );
    }

    /// Atomically replace the session's stream state with one seeded to
    /// `items`, running `replay` in the same critical section — so a
    /// concurrent live revision can neither interleave with the replay nor
    /// diff against pre-replay state. Any revision buffered by
    /// [`Self::begin_resume`] while the snapshot was in flight is diffed
    /// against the freshly seeded state and sent as a catch-up frame AFTER
    /// the replay, so it lands as a follow-up `session/update`, never folded
    /// into the replay itself.
    ///
    /// The slot [`Self::begin_resume`] placed is the resume's claim on this
    /// session: if a `session_detach` or `ChatEnded` dropped it while the
    /// snapshot was in flight, the client is no longer listening, so nothing
    /// is re-created and no replay is delivered. `reply` goes out either way
    /// — the client's `session/resume` promise must settle even when its own
    /// detach won the race.
    pub fn reset_session(
        &self,
        connection: &FacadeConnection,
        chat_id: &str,
        seed: ResumeSeed<'_>,
        replay: impl FnOnce(&FacadeConnection),
    ) {
        let mut sessions = connection.locked_sessions();
        let Some(previous) = sessions.remove(chat_id) else {
            drop(sessions);
            connection.send_json(seed.reply);
            return;
        };
        let mut stream = SessionStream::new(self.throttle_interval_ms);
        stream.seed(seed.items);
        let catch_up = drain_into(&mut stream, previous, connection, seed.redelivered_gate);
        sessions.insert(chat_id.to_string(), SessionSlot::Live(stream));
        connection.send_json(seed.reply);
        replay(connection);
        for frame in catch_up {
            connection.send_throttled(chat_id, frame);
        }
    }

    /// Redeliver a gate the resume snapshot still reports as open. The
    /// snapshot is computed before [`Self::reset_session`] runs, so the gate
    /// may have been answered on another surface in between — the registry
    /// has recorded that and `_mainframe.dev/gate_resolved` has already gone
    /// out, so raising it now would hand the client a live gate the daemon
    /// has closed. The connection's own pending map cannot answer this:
    /// redelivery IS the registration.
    pub fn redeliver_gate(
        &self,
        connection: &FacadeConnection,
        chat_id: &str,
        request: &ControlRequest,
        frame: &JsonRpcRequest,
    ) {
        // Scoped to a statement: the registry lock is never held across a
        // connection lock.
        let resolved = self
            .locked_registry()
            .is_resolved(chat_id, &request.request_id);
        if resolved {
            debug!(
                chat_id,
                request_id = %request.request_id,
                "acp facade: skipped redelivering a gate resolved since the snapshot"
            );
            return;
        }
        connection.deliver_gate(chat_id, request, frame);
    }

    pub fn claim_gate(&self, chat_id: &str, request_id: &str) -> AnswerOutcome {
        self.locked_registry().claim(chat_id, request_id)
    }

    pub fn release_gate(&self, chat_id: &str, request_id: &str) {
        self.locked_registry().release(chat_id, request_id);
    }

    /// Flush every attached session's held throttle tail on `connection` —
    /// the socket loop's periodic tick.
    pub fn flush_connection(&self, connection: &FacadeConnection) {
        let now = now_ms();
        let mut sessions = connection.locked_sessions();
        for (chat_id, slot) in sessions.iter_mut() {
            if let SessionSlot::Live(stream) = slot {
                for frame in stream.flush(now) {
                    connection.send_throttled(chat_id, frame);
                }
            }
        }
    }

    fn locked_registry(&self) -> std::sync::MutexGuard<'_, GateRegistry> {
        self.gates.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// What a completing `session/resume` hands [`FacadeHub::reset_session`].
pub struct ResumeSeed<'a> {
    /// The snapshot the connection's stream is re-seeded to.
    pub items: &'a [EncodedItem],
    /// The `session/resume` reply, sent ahead of the replay — and sent even
    /// when the session is gone, so the client's promise always settles.
    pub reply: &'a JsonRpcResponse,
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
fn drain_into(
    stream: &mut SessionStream,
    buffered: SessionSlot,
    connection: &FacadeConnection,
    redelivered_gate: Option<&str>,
) -> Vec<ThrottledFrame> {
    let SessionSlot::AwaitingSeed { pending } = buffered else {
        return Vec::new();
    };
    let now = now_ms();
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
        frames.extend(fanout::run_op(stream, op, now));
    }
    frames
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests;
