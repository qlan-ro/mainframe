//! One attached `/acp/{profile}` connection: the outbound frame channel its
//! socket loop drains, per-session stream state, and gates delivered but not
//! yet answered (todo #350, live-wiring pass).

use std::collections::HashMap;
use std::sync::Mutex;

use mainframe_acp::gate_request_id;
use mainframe_acp::stream::SessionStream;
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

pub struct FacadeConnection {
    pub profile: String,
    tx: mpsc::UnboundedSender<String>,
    sessions: Mutex<HashMap<String, SessionStream>>,
    pending_gates: Mutex<HashMap<String, PendingGate>>,
}

impl FacadeConnection {
    pub(super) fn new(profile: String, tx: mpsc::UnboundedSender<String>) -> Self {
        Self {
            profile,
            tx,
            sessions: Mutex::new(HashMap::new()),
            pending_gates: Mutex::new(HashMap::new()),
        }
    }

    pub(super) fn locked_sessions(
        &self,
    ) -> std::sync::MutexGuard<'_, HashMap<String, SessionStream>> {
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

    /// Deliver a `session/request_permission` for `request` and remember it
    /// for answer correlation — shared by the live raise path and resume
    /// redelivery (which passes the request frame it already built).
    pub fn deliver_gate(&self, chat_id: &str, request: &ControlRequest, frame: &JsonRpcRequest) {
        self.locked_gates().insert(
            rpc_id_string(&request.request_id),
            PendingGate {
                chat_id: chat_id.to_string(),
                request: request.clone(),
            },
        );
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
