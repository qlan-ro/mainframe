//! One attached `/acp/{profile}` connection: the outbound frame channel its
//! socket loop drains, per-session stream state, and gates delivered but not
//! yet answered.

use mainframe_types::sync::LockExt as _;
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
pub(super) use slots::{LazyFullEncoding, SessionSlot, StreamOp};
pub use slots::{PendingGate, SessionLockWait};

pub struct FacadeConnection {
    pub profile: String,
    tx: mpsc::UnboundedSender<String>,
    sessions: Mutex<HashMap<String, SessionSlot>>,
    pending_gates: Mutex<HashMap<String, PendingGate>>,
    /// Set once a successful `initialize` negotiates the pinned protocol
    /// version — read from the socket-loop task on every inbound frame, so an
    /// `Atomic` rather than a `Mutex` (no critical section to hold, just a
    /// flag).
    negotiated: AtomicBool,
    /// Set once a successful `initialize` also opted into revision-versioned
    /// resume cursors (`REVISION_CURSORS_OPT_IN_KEY`). Gates every `cursor`
    /// reply meta, `_mainframe.dev/cursor` notification, and the hub's decision
    /// to create this chat's `RevisionLog` on this connection's resume — a
    /// connection that never sets this gets byte-identical legacy behavior.
    revision_cursors_opted_in: AtomicBool,
    /// Set once a successful `initialize` opted into replay result previews
    /// (`REPLAY_RESULT_PREVIEWS_OPT_IN_KEY`): this
    /// connection's full resume replays send old tool results as previews
    /// and its seeded streams keep trimming those ids. Never set means every
    /// replayed result stays full, byte-identical to before.
    replay_result_previews_opted_in: AtomicBool,
    /// Set once a successful `initialize` opted into compressed replay
    /// batches (`COMPRESSED_REPLAY_OPT_IN_KEY`): this
    /// connection's resume replays travel as `_mainframe.dev/replay_batch`
    /// frames instead of one `session/update` per item.
    compressed_replay_opted_in: AtomicBool,
    /// One `tokio::sync::Mutex` per session, held for the duration of a spawned
    /// `session/prompt`. Serializes concurrent prompts for the SAME session —
    /// queue position and the queue's tail ordering both depend on which of two
    /// concurrent prompts enqueues first — while leaving different sessions
    /// free to run their prompts in parallel.
    prompt_locks: mainframe_runtime::sync::KeyedMutex,
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
            revision_cursors_opted_in: AtomicBool::new(false),
            replay_result_previews_opted_in: AtomicBool::new(false),
            compressed_replay_opted_in: AtomicBool::new(false),
            prompt_locks: mainframe_runtime::sync::KeyedMutex::default(),
            resume_failures: Mutex::new(HashMap::new()),
        }
    }

    /// Take a place in this session's lock queue NOW, for a caller that will
    /// await the guard from a spawned task. Tokio's mutex is fair in first-poll
    /// order, and a spawned task is first polled whenever the runtime gets to
    /// it — so two frames spawned back to back could acquire in either order.
    /// Polling once here, on the socket loop, makes arrival order the
    /// acquisition order.
    pub(crate) fn enqueue_prompt_lock(&self, session_id: &str) -> SessionLockWait {
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
    pub(crate) fn session_prompt_lock(&self, session_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.prompt_locks.get(session_id)
    }

    /// Count one failed resume for `chat_id` and report how many in a row
    /// that makes — the failure path pushes its recovery notification on the
    /// first only.
    pub(crate) fn record_resume_failure(&self, chat_id: &str) -> u32 {
        let mut failures = self.locked_resume_failures();
        let count = failures.entry(chat_id.to_string()).or_insert(0);
        *count += 1;
        *count
    }

    pub(crate) fn clear_resume_failures(&self, chat_id: &str) {
        self.locked_resume_failures().remove(chat_id);
    }

    fn locked_resume_failures(&self) -> std::sync::MutexGuard<'_, HashMap<String, u32>> {
        self.resume_failures.lock_recover()
    }

    pub(crate) fn is_negotiated(&self) -> bool {
        self.negotiated.load(Ordering::Relaxed)
    }

    pub(crate) fn mark_negotiated(&self) {
        self.negotiated.store(true, Ordering::Relaxed);
    }

    pub(crate) fn is_revision_cursors_opted_in(&self) -> bool {
        self.revision_cursors_opted_in.load(Ordering::Relaxed)
    }

    pub fn mark_revision_cursors_opted_in(&self) {
        self.revision_cursors_opted_in
            .store(true, Ordering::Relaxed);
    }

    pub(crate) fn is_replay_result_previews_opted_in(&self) -> bool {
        self.replay_result_previews_opted_in.load(Ordering::Relaxed)
    }

    pub(crate) fn mark_replay_result_previews_opted_in(&self) {
        self.replay_result_previews_opted_in
            .store(true, Ordering::Relaxed);
    }

    pub(crate) fn is_compressed_replay_opted_in(&self) -> bool {
        self.compressed_replay_opted_in.load(Ordering::Relaxed)
    }

    pub(crate) fn mark_compressed_replay_opted_in(&self) {
        self.compressed_replay_opted_in
            .store(true, Ordering::Relaxed);
    }

    pub(super) fn locked_sessions(
        &self,
    ) -> std::sync::MutexGuard<'_, HashMap<String, SessionSlot>> {
        self.sessions.lock_recover()
    }

    fn locked_gates(&self) -> std::sync::MutexGuard<'_, HashMap<String, PendingGate>> {
        self.pending_gates.lock_recover()
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
    /// rpc_id answerable again. No frame is sent; the client already
    /// has the request.
    pub(crate) fn restore_gate(&self, rpc_id: &str, pending: PendingGate) {
        self.locked_gates().insert(rpc_id.to_string(), pending);
    }

    /// Chat teardown (`ChatSurfaceEvent::ChatEnded`): drop the session's
    /// stream state, any gates delivered for it, and its prompt lock —
    /// otherwise all three outlive the chat for the connection's whole
    /// lifetime.
    ///
    /// Pruning weak entries never replaces a lock held by an active prompt.
    pub fn forget_chat(&self, chat_id: &str) {
        self.locked_sessions().remove(chat_id);
        self.locked_gates()
            .retain(|_, gate| gate.chat_id != chat_id);
        self.prompt_locks.prune();
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
    pub(crate) fn send_raw(&self, payload: String) {
        self.send_frame(payload);
    }

    /// Dispatch one throttle-drained frame: an update through the normal
    /// `session/update` envelope, a raw frame as-is, or a revision-
    /// cursor boundary as `_mainframe.dev/cursor` — only for a
    /// connection that opted in. The run-op layer already filters a cursor
    /// out before it ever reaches a non-opted connection's throttle FIFO
    /// (`fanout.rs::run_op`); this check is the second, defensive gate, so
    /// nothing short of that filtering ever reaches the wire for one.
    pub(crate) fn send_throttled(&self, chat_id: &str, frame: ThrottledFrame) {
        match frame {
            ThrottledFrame::Update(update) => self.send_update(chat_id, update),
            ThrottledFrame::Raw(payload) => self.send_frame(payload),
            ThrottledFrame::Cursor(cursor) => {
                if self.is_revision_cursors_opted_in() {
                    self.send_json(&mainframe_acp::cursor_notification(chat_id, &cursor));
                }
            }
        }
    }

    /// Remember a delivered `session/request_permission` for answer
    /// correlation, without sending anything — the send is a separate step
    /// (`send_raw`/`send_throttled`) so the live raise path can throttle it
    /// while registration itself stays unconditional and immediate.
    pub(crate) fn register_gate(&self, chat_id: &str, request: &ControlRequest) {
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
