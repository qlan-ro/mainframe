//! One attached `/acp/{profile}` connection: the outbound frame channel its
//! socket loop drains, per-session stream state, and gates delivered but not
//! yet answered (todo #350, live-wiring pass).

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use mainframe_acp::{ThrottledFrame, gate_request_id};
use mainframe_types::acp::jsonrpc::{JsonRpcNotification, JsonRpcRequest, RequestId};
use mainframe_types::acp::update::{SessionUpdate, UpdateSessionNotification};
use mainframe_types::adapter::ControlRequest;
use tokio::sync::mpsc;
use tracing::warn;

mod slots;
pub use slots::{PendingGate, SessionLockWait};
pub(super) use slots::{SessionSlot, StreamOp};

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
    /// Consecutive failed `session/resume` deliveries per session. NOT
    /// reclaimed by `forget_chat`: the failure path detaches the session
    /// itself, and reclaiming there would reset the very count that stops a
    /// resync/retry loop.
    resume_failures: Mutex<HashMap<String, u32>>,
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
            resume_failures: Mutex::new(HashMap::new()),
        }
    }

    /// Take a place in this session's lock queue NOW, for a caller that will
    /// await the guard from a spawned task. Tokio's mutex is fair in first-poll
    /// order, and a spawned task is first polled whenever the runtime gets to
    /// it — so two frames spawned back to back could acquire in either order.
    /// Polling once here, on the socket loop, makes arrival order the
    /// acquisition order.
    pub fn enqueue_prompt_lock(&self, session_id: &str) -> SessionLockWait {
        // `unconstrained`: tokio's `Acquire::poll` checks the coop budget
        // before the semaphore, so a spent budget would report Pending with
        // no waiter registered — queued in name, last in line in fact.
        let mut acquire = Box::pin(tokio::task::coop::unconstrained(
            self.session_prompt_lock(session_id).lock_owned(),
        ));
        let mut cx = std::task::Context::from_waker(std::task::Waker::noop());
        match acquire.as_mut().poll(&mut cx) {
            std::task::Poll::Ready(guard) => SessionLockWait::Held(guard),
            std::task::Poll::Pending => SessionLockWait::Queued(acquire),
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

    /// Count one failed resume for `chat_id` and report how many in a row
    /// that makes — the failure path pushes its recovery notification on the
    /// first only.
    pub fn record_resume_failure(&self, chat_id: &str) -> u32 {
        let mut failures = self.locked_resume_failures();
        let count = failures.entry(chat_id.to_string()).or_insert(0);
        *count += 1;
        *count
    }

    pub fn clear_resume_failures(&self, chat_id: &str) {
        self.locked_resume_failures().remove(chat_id);
    }

    fn locked_resume_failures(&self) -> std::sync::MutexGuard<'_, HashMap<String, u32>> {
        self.resume_failures
            .lock()
            .unwrap_or_else(|e| e.into_inner())
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
    /// lifetime.
    ///
    /// The prompt lock goes only when nothing else holds it. A call still in
    /// flight owns a clone, and replacing the entry would hand the next call
    /// for that session a different mutex — two calls then enqueue
    /// concurrently, which is the ordering the lock exists to prevent. The
    /// entry a running call keeps alive is reclaimed by the next teardown.
    pub fn forget_chat(&self, chat_id: &str) {
        self.locked_sessions().remove(chat_id);
        self.locked_gates()
            .retain(|_, gate| gate.chat_id != chat_id);
        let mut locks = self.prompt_locks.lock().unwrap_or_else(|e| e.into_inner());
        if locks
            .get(chat_id)
            .is_some_and(|lock| Arc::strong_count(lock) == 1)
        {
            locks.remove(chat_id);
        }
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
