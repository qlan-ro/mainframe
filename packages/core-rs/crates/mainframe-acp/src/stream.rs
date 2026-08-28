//! One attached (connection, session) pair's outbound stream state (todo
//! #350, live-wiring pass): the assembly of the diff engine
//! (`session_state.rs`), the retry marker (spec decision 10), the turn
//! lifecycle's `StateUpdate` frames, and the coalescing throttle
//! (`throttle.rs`) into a single pure state machine. `mainframe-server`'s
//! facade hub owns one `SessionStream` per attached session per connection
//! and forwards whatever these methods return to the socket — everything
//! order- or content-sensitive is decided here, behind unit tests, not in
//! the socket shell.
//!
//! Lifecycle frames go through the same throttle FIFO as content so an
//! `Idle` stop can never overtake the final buffered chunks of its own turn.

use mainframe_types::acp::extensions::{MAINFRAME_META_NAMESPACE, RetryMarker};
use mainframe_types::acp::update::{
    IdleStateUpdate, SessionState as WireSessionState, SessionUpdate, StopReason, UsageUpdate,
};
use serde_json::{Map, Value};

use crate::encoder::EncodedItem;
use crate::session_state::SessionState;
use crate::throttle::Throttle;

pub struct SessionStream {
    state: SessionState,
    throttle: Throttle,
    /// Set by `api_retry`, attached to the next content-carrying upsert's
    /// `_meta["_mainframe.dev"]` (the fixture-pinned shape), cleared at turn
    /// end so a marker that never found a carrier cannot mislabel a later,
    /// unrelated revision.
    pending_retry: Option<RetryMarker>,
}

impl SessionStream {
    pub fn new(throttle_interval_ms: i64) -> Self {
        Self {
            state: SessionState::new(),
            throttle: Throttle::new(throttle_interval_ms),
            pending_retry: None,
        }
    }

    /// Mark `items` as already known without emitting anything — the resume
    /// path replays them itself (`resume::dispatch_resume`), and every later
    /// [`Self::on_revision`] must delta against what that replay delivered.
    pub fn seed(&mut self, items: &[EncodedItem]) {
        let _ = self.state.diff(items);
    }

    /// A display revision for this session: diff, attach any pending retry
    /// marker, and run the result through the throttle. Returns the frames
    /// due now; the rest sit buffered until the next revision or
    /// [`Self::flush`].
    pub fn on_revision(&mut self, items: &[EncodedItem], now_ms: i64) -> Vec<SessionUpdate> {
        let mut updates = self.state.diff(items);
        if self.pending_retry.is_some() {
            self.attach_retry_marker(&mut updates);
        }
        self.push_all(updates, now_ms)
    }

    pub fn on_retry(&mut self, marker: RetryMarker) {
        self.pending_retry = Some(marker);
    }

    pub fn on_turn_started(&mut self, now_ms: i64) -> Vec<SessionUpdate> {
        self.throttle.push(
            now_ms,
            SessionUpdate::StateUpdate(WireSessionState::Running),
        )
    }

    pub fn on_turn_finished(&mut self, stop_reason: StopReason, now_ms: i64) -> Vec<SessionUpdate> {
        self.pending_retry = None;
        self.throttle.push(
            now_ms,
            SessionUpdate::StateUpdate(WireSessionState::Idle(IdleStateUpdate {
                stop_reason: Some(stop_reason),
                meta: None,
            })),
        )
    }

    pub fn on_usage(&mut self, usage: UsageUpdate, now_ms: i64) -> Vec<SessionUpdate> {
        self.throttle
            .push(now_ms, SessionUpdate::UsageUpdate(usage))
    }

    /// Drain the throttle's held tail — the hub's periodic flush tick.
    pub fn flush(&mut self, now_ms: i64) -> Vec<SessionUpdate> {
        self.throttle.flush(now_ms)
    }

    fn push_all(&mut self, updates: Vec<SessionUpdate>, now_ms: i64) -> Vec<SessionUpdate> {
        let mut due = Vec::new();
        for update in updates {
            due.extend(self.throttle.push(now_ms, update));
        }
        due
    }

    /// Merge the pending marker into the first content-carrying upsert of
    /// this batch (message/thought upsert or tool-call patch — the frames
    /// that replace content, per extensions.rs's "riding a message/tool-call
    /// upsert's `_meta`"). Chunks are pure appends and never carry it. If the
    /// batch has no carrier the marker stays pending for the next one.
    fn attach_retry_marker(&mut self, updates: &mut [SessionUpdate]) {
        let Some(slot) = updates.iter_mut().find_map(upsert_meta_slot) else {
            return;
        };
        let Some(marker) = self.pending_retry.take() else {
            return;
        };
        let marker_value = serde_json::to_value(marker).unwrap_or(Value::Null);
        *slot = Some(Some(merge_namespace(slot.clone().flatten(), marker_value)));
    }
}

fn upsert_meta_slot(update: &mut SessionUpdate) -> Option<&mut Option<Option<Value>>> {
    match update {
        SessionUpdate::UserMessage(upsert)
        | SessionUpdate::AgentMessage(upsert)
        | SessionUpdate::AgentThought(upsert) => Some(&mut upsert.meta),
        SessionUpdate::ToolCallUpdate(patch) => Some(&mut patch.meta),
        _ => None,
    }
}

/// Set `_meta["_mainframe.dev"] = value` on top of whatever meta the frame
/// already carries, preserving sibling keys (e.g. the encoder's
/// `parentToolCallId`).
fn merge_namespace(existing: Option<Value>, value: Value) -> Value {
    let mut map = match existing {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    };
    map.insert(MAINFRAME_META_NAMESPACE.to_string(), value);
    Value::Object(map)
}

#[cfg(test)]
mod tests;
