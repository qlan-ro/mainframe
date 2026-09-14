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
//! Out-of-band notifications (gate-raised, queue-changed, transcript-cleared,
//! compaction) ride the same FIFO as raw `ThrottledFrame::Raw` entries for
//! the same reason — a gate can never precede the tool-call frame it answers.
//! The one exception is `GateResolved`: it targets whichever connection is
//! holding the gate, not every session subscriber, so it is sent directly
//! rather than queued through this per-session throttle.

use mainframe_types::acp::extensions::{MAINFRAME_META_NAMESPACE, RetryMarker};
use mainframe_types::acp::update::{
    IdleStateUpdate, SessionState as WireSessionState, SessionUpdate, StopReason, UsageUpdate,
};
use serde_json::{Map, Value};

use crate::encoder::EncodedItem;
use crate::session_state::SessionState;
use crate::throttle::{Throttle, ThrottledFrame};

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
    pub fn on_revision(&mut self, items: &[EncodedItem], now_ms: i64) -> Vec<ThrottledFrame> {
        let mut updates = self.state.diff(items);
        if self.pending_retry.is_some() {
            self.attach_retry_marker(&mut updates);
        }
        self.push_all(updates, now_ms)
    }

    pub fn on_retry(&mut self, marker: RetryMarker) {
        self.pending_retry = Some(marker);
    }

    pub fn on_turn_started(&mut self, now_ms: i64) -> Vec<ThrottledFrame> {
        self.throttle.push(
            now_ms,
            SessionUpdate::StateUpdate(WireSessionState::Running),
        )
    }

    pub fn on_turn_finished(
        &mut self,
        stop_reason: StopReason,
        now_ms: i64,
    ) -> Vec<ThrottledFrame> {
        self.pending_retry = None;
        self.throttle.push(
            now_ms,
            SessionUpdate::StateUpdate(WireSessionState::Idle(IdleStateUpdate {
                stop_reason: Some(stop_reason),
                meta: None,
            })),
        )
    }

    pub fn on_usage(&mut self, usage: UsageUpdate, now_ms: i64) -> Vec<ThrottledFrame> {
        self.throttle
            .push(now_ms, SessionUpdate::UsageUpdate(usage))
    }

    /// Feed a raw out-of-band notification (a gate raise, a queue snapshot,
    /// a transcript clear, a compaction phase) into the SAME FIFO content
    /// updates sit in, so it cannot arrive on the wire ahead of a still-
    /// buffered update it depends on (R2.11) — e.g. a gate for a tool call
    /// whose creation frame has not flushed yet.
    pub fn push_raw(&mut self, frame_json: String, now_ms: i64) -> Vec<ThrottledFrame> {
        self.throttle.push_raw(now_ms, frame_json)
    }

    /// Drain the throttle's held tail — the hub's periodic flush tick.
    pub fn flush(&mut self, now_ms: i64) -> Vec<ThrottledFrame> {
        self.throttle.flush(now_ms)
    }

    fn push_all(&mut self, updates: Vec<SessionUpdate>, now_ms: i64) -> Vec<ThrottledFrame> {
        let mut due = Vec::new();
        for update in updates {
            due.extend(self.throttle.push(now_ms, update));
        }
        due
    }

    /// Merge the pending marker into the first content-carrying message
    /// upsert of this batch (T16, R1.4). Narrower than "any upsert with a
    /// meta slot": a `ToolCallUpdate` patch is never a carrier — a tool call
    /// already in flight when `api_error` fired would otherwise claim the
    /// marker ahead of the retry's own content, the "later unrelated one"
    /// bug this closes. Nor is an empty-content clearing upsert (the vanished-
    /// item frame `session_state.rs::clear_update` emits) — the client
    /// deletes that item on receipt (T23), so a marker riding it would just
    /// vanish. Chunks are pure appends and never carry it. If the batch has
    /// no carrier the marker stays pending for the next one.
    fn attach_retry_marker(&mut self, updates: &mut [SessionUpdate]) {
        let Some(slot) = updates.iter_mut().find_map(retry_marker_carrier) else {
            return;
        };
        let Some(marker) = self.pending_retry.take() else {
            return;
        };
        let marker_value = serde_json::to_value(marker).unwrap_or(Value::Null);
        *slot = Some(Some(merge_namespace(slot.clone().flatten(), marker_value)));
    }
}

fn retry_marker_carrier(update: &mut SessionUpdate) -> Option<&mut Option<Option<Value>>> {
    match update {
        SessionUpdate::UserMessage(upsert)
        | SessionUpdate::AgentMessage(upsert)
        | SessionUpdate::AgentThought(upsert)
            if !is_empty_content_clear(&upsert.content) =>
        {
            Some(&mut upsert.meta)
        }
        _ => None,
    }
}

/// True for `session_state.rs::clear_update`'s frame: `content` patched to
/// an explicit empty list, the vanished-item signal T23's `applyUpsert`
/// deletes the item on.
fn is_empty_content_clear(
    content: &Option<Option<Vec<mainframe_types::acp::content::ContentBlock>>>,
) -> bool {
    matches!(content, Some(Some(blocks)) if blocks.is_empty())
}

/// Merge `value`'s keys into `_meta["_mainframe.dev"]` on top of whatever
/// the frame already carries — the encoder's parent relation and the retry
/// marker share the namespace object, so a marker must extend it, never
/// replace it.
fn merge_namespace(existing: Option<Value>, value: Value) -> Value {
    let mut map = match existing {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    };
    let mut namespace = match map.remove(MAINFRAME_META_NAMESPACE) {
        Some(Value::Object(namespace)) => namespace,
        _ => Map::new(),
    };
    if let Value::Object(new_keys) = value {
        namespace.extend(new_keys);
    }
    map.insert(
        MAINFRAME_META_NAMESPACE.to_string(),
        Value::Object(namespace),
    );
    Value::Object(map)
}

#[cfg(test)]
mod tests;
