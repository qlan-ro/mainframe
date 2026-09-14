//! One attached `/acp/{profile}` connection: the outbound frame channel its
//! socket loop drains, per-session stream state, and gates delivered but not
//! yet answered (todo #350, live-wiring pass).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use mainframe_acp::stream::SessionStream;
use mainframe_acp::{ThrottledFrame, gate_request_id};
use mainframe_types::acp::jsonrpc::{JsonRpcNotification, JsonRpcRequest, RequestId};
use mainframe_types::acp::update::{SessionUpdate, UpdateSessionNotification};
use mainframe_types::adapter::ControlRequest;
use tokio::sync::mpsc;
use tracing::warn;

/// A gate delivered to a connection and not yet answered, keyed by the
/// JSON-RPC id its `session/request_permission` traveled under.
#[derive(Clone)]
pub struct PendingGate {
    pub chat_id: String,
    pub request: ControlRequest,
}

/// One raw out-of-band frame held for the duration of a resume's snapshot
/// await. A gate raise carries the rpc id it was delivered under, so the
/// drain can recognize the gate the replay redelivers on its own and not
/// hand the client two live requests for one decision.
pub(super) struct BufferedRaw {
    pub payload: String,
    pub gate_rpc_id: Option<String>,
}

/// A connection's per-session slot. `AwaitingSeed` covers the window a
/// `session/resume` spends awaiting its snapshot (T5, R2.9): a live revision
/// racing that await has nowhere seeded to diff against yet, so its item
/// snapshot is buffered — overwritten by any later one, since only the
/// latest matters — instead of diffed and instead of dropped. Raw
/// out-of-band frames raised in the same window are buffered too, in arrival
/// order, or they would reach the client ahead of the replay they predate.
/// `reset_session` drains both once the stream is seeded.
pub(super) enum SessionSlot {
    Live(SessionStream),
    AwaitingSeed {
        latest: Option<Vec<mainframe_acp::EncodedItem>>,
        raws: Vec<BufferedRaw>,
    },
}

pub struct FacadeConnection {
    pub profile: String,
    tx: mpsc::UnboundedSender<String>,
    sessions: Mutex<HashMap<String, SessionSlot>>,
    pending_gates: Mutex<HashMap<String, PendingGate>>,
    /// Set once a successful `initialize` negotiates the pinned protocol
    /// version (R3.21) — read from the socket-loop task on every inbound
    /// frame, so an `Atomic` rather than a `Mutex` (no critical section to
    /// hold, just a flag).
    negotiated: AtomicBool,
    /// One `tokio::sync::Mutex` per session, held for the duration of a
    /// spawned `session/prompt` (T10). Serializes concurrent prompts for the
    /// SAME session — queue position and D1's tail ordering both depend on
    /// which of two concurrent prompts enqueues first — while leaving
    /// different sessions free to run their prompts in parallel.
    prompt_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl FacadeConnection {
    pub(super) fn new(profile: String, tx: mpsc::UnboundedSender<String>) -> Self {
        Self {
            profile,
            tx,
            sessions: Mutex::new(HashMap::new()),
            pending_gates: Mutex::new(HashMap::new()),
            negotiated: AtomicBool::new(false),
            prompt_locks: Mutex::new(HashMap::new()),
        }
    }

    /// Acquire this session's prompt-serialization lock, creating it on
    /// first use. Held by the caller for the lifetime of one spawned prompt
    /// dispatch.
    pub fn session_prompt_lock(&self, session_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.prompt_locks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    pub fn is_negotiated(&self) -> bool {
        self.negotiated.load(Ordering::Relaxed)
    }

    pub fn mark_negotiated(&self) {
        self.negotiated.store(true, Ordering::Relaxed);
    }

    pub(super) fn locked_sessions(
        &self,
    ) -> std::sync::MutexGuard<'_, HashMap<String, SessionSlot>> {
        self.sessions.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn locked_gates(&self) -> std::sync::MutexGuard<'_, HashMap<String, PendingGate>> {
        self.pending_gates.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn is_attached(&self, chat_id: &str) -> bool {
        self.locked_sessions().contains_key(chat_id)
    }

    /// Look at (without consuming) the pending gate a response's id answers.
    /// The answer path keeps the entry until it parses an applicable answer,
    /// so a malformed reply doesn't destroy the client's only chance to
    /// answer the gate.
    pub fn peek_gate(&self, rpc_id: &str) -> Option<PendingGate> {
        self.locked_gates().get(rpc_id).cloned()
    }

    pub fn remove_gate(&self, rpc_id: &str) -> Option<PendingGate> {
        self.locked_gates().remove(rpc_id)
    }

    /// Re-register a gate under its original id after a failed apply — the
    /// answer path already removed it, and a client retry must find the same
    /// rpc_id answerable again (T3). No frame is sent; the client already
    /// has the request.
    pub fn restore_gate(&self, rpc_id: &str, pending: PendingGate) {
        self.locked_gates().insert(rpc_id.to_string(), pending);
    }

    /// Chat teardown (`ChatSurfaceEvent::ChatEnded`): drop the session's
    /// stream state, any gates delivered for it, and its prompt lock —
    /// otherwise all three outlive the chat for the connection's whole
    /// lifetime. A prompt still holding the removed lock keeps its own `Arc`
    /// alive and finishes under it; a later prompt for a re-created chat
    /// simply starts a fresh one.
    pub fn forget_chat(&self, chat_id: &str) {
        self.locked_sessions().remove(chat_id);
        self.locked_gates()
            .retain(|_, gate| gate.chat_id != chat_id);
        self.prompt_locks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(chat_id);
    }

    fn send_frame(&self, payload: String) {
        // A send error means the socket loop is gone; the unregister race is
        // benign — the frame has nowhere to go. /* expected */
        let _ = self.tx.send(payload);
    }

    pub fn send_update(&self, chat_id: &str, update: SessionUpdate) {
        let note = JsonRpcNotification {
            jsonrpc: "2.0".into(),
            method: "session/update".into(),
            params: serde_json::to_value(UpdateSessionNotification {
                session_id: chat_id.to_string(),
                update,
                meta: None,
            })
            .ok(),
        };
        self.send_json(&note);
    }

    pub fn send_json<T: serde::Serialize>(&self, frame: &T) {
        match serde_json::to_string(frame) {
            Ok(payload) => self.send_frame(payload),
            Err(err) => warn!(%err, "acp facade: failed to serialize outbound frame"),
        }
    }

    /// A pre-serialized frame, sent unthrottled — a spawned `session/prompt`
    /// reply, which belongs to no session's update FIFO.
    pub fn send_raw(&self, payload: String) {
        self.send_frame(payload);
    }

    /// Dispatch one throttle-drained frame: an update through the normal
    /// `session/update` envelope, a raw frame as-is (T6).
    pub fn send_throttled(&self, chat_id: &str, frame: ThrottledFrame) {
        match frame {
            ThrottledFrame::Update(update) => self.send_update(chat_id, update),
            ThrottledFrame::Raw(payload) => self.send_frame(payload),
        }
    }

    /// Remember a delivered `session/request_permission` for answer
    /// correlation, without sending anything — the send is a separate step
    /// (`send_raw`/`send_throttled`) so the live raise path can throttle it
    /// while registration itself stays unconditional and immediate.
    pub fn register_gate(&self, chat_id: &str, request: &ControlRequest) {
        self.locked_gates().insert(
            rpc_id_string(&request.request_id),
            PendingGate {
                chat_id: chat_id.to_string(),
                request: request.clone(),
            },
        );
    }

    /// Register and send a `session/request_permission` immediately —
    /// resume redelivery, which runs inside `reset_session`'s own atomic
    /// seed-and-deliver block and has no throttle to ride.
    pub fn deliver_gate(&self, chat_id: &str, request: &ControlRequest, frame: &JsonRpcRequest) {
        self.register_gate(chat_id, request);
        self.send_json(frame);
    }
}

/// The map key under which a gate's `session/request_permission` id is
/// remembered — the string form of [`gate_request_id`].
pub fn rpc_id_string(request_id: &str) -> String {
    match gate_request_id(request_id) {
        RequestId::Str(s) => s,
        RequestId::Number(n) => n.to_string(),
    }
}

#[cfg(test)]
mod tests;
