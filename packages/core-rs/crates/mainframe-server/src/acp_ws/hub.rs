//! The facade hub — the live assembly point between the chat-surface seam
//! (`mainframe_chat::chat_surface`) and the `/acp/{profile}` connections
//! (todo #350, live-wiring pass). One `FacadeHub` exists per daemon, attached
//! to the `ChatManager` at boot (`build_chat_manager`); it fans every
//! chat-surface event out to the connections attached to that chat, with the
//! per-session encode → diff → throttle pipeline delegated to the pure
//! `mainframe_acp::SessionStream`. This file owns the connection registry
//! and the resume seed/teardown lifecycle; `fanout.rs` owns per-event
//! delivery and `handlers.rs` the `ChatSurface` sink itself.

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use mainframe_acp::revision_log::RevisionLog;
use mainframe_acp::stream::SessionStream;
use mainframe_acp::{AnswerOutcome, GateRegistry};
use mainframe_chat::chat_surface::ChatSurface;
use mainframe_types::acp::extensions::RevisionCursor;
use mainframe_types::acp::jsonrpc::JsonRpcRequest;
use mainframe_types::adapter::ControlRequest;
use tokio::sync::mpsc;
use tracing::debug;

use super::facade_conn::{FacadeConnection, SessionSlot, rpc_id_string};

mod fanout;
mod handlers;
mod revisions;
pub use fanout::ResumeSeed;
use fanout::drain_into;
use revisions::RevisionRegistry;

/// Coalescing window for chunk fan-out (spec decision 14) and the cadence of
/// each connection's flush tick — an implementation choice per the spec; the
/// no-full-resend guarantee itself lives in `SessionState`, not here.
pub const FACADE_THROTTLE_INTERVAL_MS: i64 = 100;

pub struct FacadeHub {
    connections: DashMap<String, Arc<FacadeConnection>>,
    gates: Mutex<GateRegistry>,
    throttle_interval_ms: i64,
    /// Per-chat revision logs (todo #377) — see `revisions.rs`.
    revisions: RevisionRegistry,
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
            revisions: RevisionRegistry::default(),
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
    /// awaited (T5, R2.9): a live event racing the await has nothing seeded
    /// to diff against, so [`Self::on_chat_surface_event`] buffers it here
    /// instead of dropping it. Discarding a prior `Live` state is safe — a
    /// resume always ends by fully reseeding via [`Self::reset_session`] —
    /// but an overlapping earlier await is NOT: two resumes for one session
    /// can be in flight at once (a gap watchdog racing a reattach), and the
    /// second claim would throw away everything the first one's window had
    /// already buffered.
    ///
    /// Returns the chat's revision log (todo #377) for an opted-in
    /// connection, creating one if it has none yet, paired with the log's
    /// boundary at this exact moment — read under the log's own lock, right
    /// after the `AwaitingSeed` claim above is installed and strictly
    /// BEFORE the caller awaits `ResumePort::resume_snapshot`. This is the
    /// boundary for which "any change at or below it was emitted before the
    /// snapshot read" actually holds: any `record` racing the snapshot
    /// await lands after this claim exists, so it is buffered as catch-up
    /// here, never missed outright, and never silently folded into the
    /// reply's own cursor either — `dispatch_resume`/`revision::resolve`
    /// must reply with THIS boundary, not a fresh `log.boundary()` read
    /// after the snapshot, or the reply could acknowledge a change the
    /// client never received (see `revision::resolve`'s doc for the full
    /// argument). `None` for a connection that did not opt in.
    pub fn begin_resume(
        &self,
        connection: &FacadeConnection,
        chat_id: &str,
    ) -> Option<(Arc<Mutex<RevisionLog>>, RevisionCursor)> {
        let mut sessions = connection.locked_sessions();
        let already_awaiting = matches!(
            sessions.get(chat_id),
            Some(SessionSlot::AwaitingSeed { .. })
        );
        if !already_awaiting {
            sessions.insert(
                chat_id.to_string(),
                SessionSlot::AwaitingSeed {
                    pending: Vec::new(),
                },
            );
        }
        drop(sessions);
        let log =
            self.revision_log_for_resume(connection.is_revision_cursors_opted_in(), chat_id)?;
        let boundary = log.lock().unwrap_or_else(|err| err.into_inner()).boundary();
        Some((log, boundary))
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
    ///
    /// Both arms close with `_mainframe.dev/replay_complete` (spec Decision
    /// 38) right after their last replay frame (`queue_state`, in the seeded
    /// arm's `replay` closure) and before any buffered catch-up — the
    /// invariant every successful reply gets exactly one matching marker.
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
            seed.replied.store(true, Ordering::Relaxed);
            connection.send_json(&mainframe_acp::replay_complete_notification(chat_id, false));
            seed.completed.store(true, Ordering::Relaxed);
            return;
        };
        let mut stream = SessionStream::new(self.throttle_interval_ms);
        stream.set_previews(seed.preview_ids.clone());
        stream.seed_containers(seed.containers);
        let catch_up = drain_into(&mut stream, previous, connection, seed.redelivered_gate);
        sessions.insert(chat_id.to_string(), SessionSlot::Live(stream));
        connection.send_json(seed.reply);
        seed.replied.store(true, Ordering::Relaxed);
        replay(connection);
        connection.send_json(&mainframe_acp::replay_complete_notification(chat_id, false));
        seed.completed.store(true, Ordering::Relaxed);
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

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests;
