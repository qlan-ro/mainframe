//! The facade hub — the live assembly point between the chat-surface seam
//! (`mainframe_chat::chat_surface`) and the `/acp/{profile}` connections
//! (todo #350, live-wiring pass). One `FacadeHub` exists per daemon, attached
//! to the `ChatManager` at boot (`build_chat_manager`); it fans every
//! chat-surface event out to the connections attached to that chat, with the
//! per-session encode → diff → throttle pipeline delegated to the pure
//! `mainframe_acp::SessionStream`.

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use mainframe_acp::stream::SessionStream;
use mainframe_acp::{
    AnswerOutcome, EncodedItem, GateRegistry, ThrottledFrame, encoder, gate_request_id,
};
use mainframe_chat::chat_surface::{
    ChatSurface, ChatSurfaceEvent, CompactionPhase, TurnStopReason,
};
use mainframe_types::acp::extensions::{
    CompactionWirePhase, MAINFRAME_META_NAMESPACE, RetryMarker, UsageMeta,
};
use mainframe_types::acp::update::{StopReason, UsageUpdate};
use mainframe_types::adapter::ContextUsage;
use tokio::sync::mpsc;
use tracing::{debug, warn};

use super::facade_conn::{FacadeConnection, SessionSlot, rpc_id_string};

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
            SessionSlot::AwaitingSeed { latest: None },
        );
    }

    /// Atomically replace the session's stream state with one seeded to
    /// `items`, running `deliver` (the resume reply + replay send) in the
    /// same critical section — so a concurrent live revision can neither
    /// interleave with the replay nor diff against pre-replay state. Any
    /// revision buffered by [`Self::begin_resume`] while the snapshot was in
    /// flight is diffed against the freshly seeded state and sent as a
    /// catch-up frame AFTER `deliver`, so it lands as a follow-up
    /// `session/update`, never folded into the replay itself.
    pub fn reset_session(
        &self,
        connection: &FacadeConnection,
        chat_id: &str,
        items: &[EncodedItem],
        deliver: impl FnOnce(&FacadeConnection),
    ) {
        let mut sessions = connection.locked_sessions();
        let mut stream = SessionStream::new(self.throttle_interval_ms);
        stream.seed(items);
        let buffered = match sessions.remove(chat_id) {
            Some(SessionSlot::AwaitingSeed { latest }) => latest,
            _ => None,
        };
        let catch_up = buffered
            .map(|latest| stream.on_revision(&latest, now_ms()))
            .unwrap_or_default();
        sessions.insert(chat_id.to_string(), SessionSlot::Live(stream));
        deliver(connection);
        for frame in catch_up {
            connection.send_throttled(chat_id, frame);
        }
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

    fn attached_connections(&self, chat_id: &str) -> Vec<Arc<FacadeConnection>> {
        self.connections
            .iter()
            .filter(|entry| entry.value().is_attached(chat_id))
            .map(|entry| Arc::clone(entry.value()))
            .collect()
    }

    /// Run `per_stream` against every attached, SEEDED session and send its
    /// updates — diff and publish inside the same per-connection lock (T5,
    /// R1.2), so a diff can never be computed under the lock and enqueued
    /// after it, where a second diff for the same session could interleave
    /// ahead of it. A session still `AwaitingSeed` (a resume in flight) is
    /// skipped here, same as an unattached one — only
    /// [`Self::on_display_revision`] buffers for that state.
    fn for_each_attached_session(
        &self,
        chat_id: &str,
        mut per_stream: impl FnMut(&mut SessionStream, i64) -> Vec<ThrottledFrame>,
    ) {
        let now = now_ms();
        for connection in self.attached_connections(chat_id) {
            let mut sessions = connection.locked_sessions();
            if let Some(SessionSlot::Live(stream)) = sessions.get_mut(chat_id) {
                for frame in per_stream(stream, now) {
                    connection.send_throttled(chat_id, frame);
                }
            }
        }
    }

    /// [`ChatSurfaceEvent::DisplayRevision`]'s handler: unlike the other
    /// event kinds, a connection `AwaitingSeed` for this chat must not be
    /// skipped — its latest item snapshot is buffered so
    /// [`Self::reset_session`] can diff it against the seed it is about to
    /// receive (T5, R2.9), instead of the revision vanishing for a
    /// reconnecting client.
    fn on_display_revision(&self, chat_id: &str, items: &[EncodedItem]) {
        let now = now_ms();
        for connection in self.attached_connections(chat_id) {
            let mut sessions = connection.locked_sessions();
            match sessions.get_mut(chat_id) {
                Some(SessionSlot::Live(stream)) => {
                    for frame in stream.on_revision(items, now) {
                        connection.send_throttled(chat_id, frame);
                    }
                }
                Some(SessionSlot::AwaitingSeed { latest }) => {
                    *latest = Some(items.to_vec());
                }
                None => {}
            }
        }
    }

    /// A raw out-of-band notification (a gate raise, queue snapshot,
    /// transcript clear, compaction phase) for every attached connection —
    /// through the SAME per-session throttle FIFO content updates ride when
    /// one exists (R2.11), so it cannot arrive ahead of a still-buffered
    /// update it depends on. A connection with no `Live` stream for this chat
    /// (unseeded, or genuinely unattached — `attached_connections` also
    /// counts `AwaitingSeed`) has no queue to order against, so it is sent
    /// directly, matching the pre-T6 behavior for that narrow window.
    fn push_raw_to_attached(&self, chat_id: &str, payload: String) {
        let now = now_ms();
        for connection in self.attached_connections(chat_id) {
            let mut sessions = connection.locked_sessions();
            match sessions.get_mut(chat_id) {
                Some(SessionSlot::Live(stream)) => {
                    for frame in stream.push_raw(payload.clone(), now) {
                        connection.send_throttled(chat_id, frame);
                    }
                }
                _ => connection.send_raw(payload.clone()),
            }
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

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

impl ChatSurface for FacadeHub {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        match event {
            // Acceptance already rides the `session/prompt` response
            // (`PromptResponse` + queued `_meta`), not a stream frame.
            ChatSurfaceEvent::TurnAccepted { .. } => {}
            ChatSurfaceEvent::TurnStarted { chat_id } => {
                self.for_each_attached_session(&chat_id, |stream, now| stream.on_turn_started(now));
            }
            ChatSurfaceEvent::TurnFinished {
                chat_id,
                stop_reason: reason,
            } => {
                self.for_each_attached_session(&chat_id, |stream, now| {
                    stream.on_turn_finished(stop_reason(reason), now)
                });
            }
            ChatSurfaceEvent::DisplayRevision { chat_id, messages } => {
                // Encode only when someone is listening: this handler runs on
                // the sink path for every chat in the daemon.
                if self.attached_connections(&chat_id).is_empty() {
                    return;
                }
                let items = encoder::encode(&messages);
                self.on_display_revision(&chat_id, &items);
            }
            ChatSurfaceEvent::GateRaised { chat_id, request } => {
                let frame = mainframe_acp::build_permission_request(
                    &chat_id,
                    gate_request_id(&request.request_id),
                    &request,
                );
                let Ok(payload) = serde_json::to_string(&frame) else {
                    warn!(chat_id, "acp facade: failed to serialize a gate request");
                    return;
                };
                // Registration (pending-gate bookkeeping) is unconditional and
                // immediate — only the actual send rides the throttle FIFO
                // (R2.11), so a gate can never precede the tool call it
                // belongs to on the wire.
                for connection in self.attached_connections(&chat_id) {
                    connection.register_gate(&chat_id, &request);
                }
                self.push_raw_to_attached(&chat_id, payload);
            }
            ChatSurfaceEvent::GateResolved {
                chat_id,
                request_id,
            } => {
                self.locked_registry().mark_resolved(&chat_id, &request_id);
                let rpc_id = rpc_id_string(&request_id);
                // A connection still holding the delivered gate did not answer
                // it (the answer path removes its own entry first) — push the
                // resolution so it clears now, not on its next resume (spec
                // criterion 8).
                let note = mainframe_acp::gate_resolved_notification(&chat_id, &rpc_id);
                for entry in self.connections.iter() {
                    if entry.value().remove_gate(&rpc_id).is_some() {
                        entry.value().send_json(&note);
                        debug!(chat_id, request_id, "acp facade: pending gate resolved");
                    }
                }
            }
            ChatSurfaceEvent::Retry {
                chat_id,
                attempt,
                reason,
            } => {
                let marker = RetryMarker { attempt, reason };
                self.for_each_attached_session(&chat_id, |stream, _now| {
                    stream.on_retry(marker.clone());
                    Vec::new()
                });
            }
            ChatSurfaceEvent::QueueChanged { chat_id, refs } => {
                let note = mainframe_acp::queue_state_notification(&chat_id, refs);
                if let Ok(payload) = serde_json::to_string(&note) {
                    self.push_raw_to_attached(&chat_id, payload);
                }
            }
            ChatSurfaceEvent::TranscriptCleared { chat_id } => {
                let note = mainframe_acp::transcript_cleared_notification(&chat_id);
                if let Ok(payload) = serde_json::to_string(&note) {
                    self.push_raw_to_attached(&chat_id, payload);
                }
            }
            ChatSurfaceEvent::Compaction { chat_id, phase } => {
                let wire_phase = match phase {
                    CompactionPhase::Started => CompactionWirePhase::Started,
                    CompactionPhase::Done => CompactionWirePhase::Done,
                };
                let note = mainframe_acp::compaction_notification(&chat_id, wire_phase);
                if let Ok(payload) = serde_json::to_string(&note) {
                    self.push_raw_to_attached(&chat_id, payload);
                }
            }
            ChatSurfaceEvent::Usage { chat_id, usage } => {
                let update = usage_update(&usage);
                self.for_each_attached_session(&chat_id, |stream, now| {
                    stream.on_usage(update.clone(), now)
                });
            }
            // Chat teardown: nothing else ever clears the gate registry's
            // per-chat bookkeeping or a connection's per-chat session state.
            ChatSurfaceEvent::ChatEnded { chat_id } => {
                self.locked_registry().forget_chat(&chat_id);
                for entry in self.connections.iter() {
                    entry.value().forget_chat(&chat_id);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
