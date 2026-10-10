//! Feeds top-level Codex `item/agentMessage/delta` notifications into the
//! shared partial-message overlay (`SessionSink::on_message_partial`), so Codex
//! agent text streams in place instead of arriving whole at `item/completed`.
//!
//! Scope is limited to the parent's own top-level agent text:
//! a registered child thread's deltas are dropped here and its completed
//! message still renders as it always has (`thread_item_render.rs`).

use std::collections::HashSet;
use std::sync::Arc;

use mainframe_adapter_api::SessionSink;
use serde::Deserialize;
use serde_json::Value;

use crate::event_mapper::{Owner, resolve_owner};
use crate::history::text_block;
use crate::session_state::CodexSessionState;

/// `AgentMessageDeltaNotification` (codex-cli 0.155.1 `generate-ts`), every
/// field required — a payload missing one fails to parse and the delta is
/// dropped rather than guessed at.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentMessageDeltaParams {
    thread_id: String,
    turn_id: String,
    item_id: String,
    delta: String,
}

/// Claude's `PARTIAL_EMIT_INTERVAL_MS` floor (`partial_stream.rs`) — Codex
/// streaming re-runs the same per-emission display-pipeline recompute, so it
/// reuses the same pacing budget.
const PARTIAL_EMIT_INTERVAL_MS: i64 = 50;

#[derive(Debug, Clone)]
struct InFlight {
    thread_id: String,
    turn_id: String,
    item_id: String,
    text: String,
}

/// Per-session in-flight accumulation for the current turn's top-level agent
/// message. Only `emit_interval_ms` is meant for test setup (set 0 to emit
/// every delta); the rest is private, driven entirely through
/// `handle_agent_message_delta` and `mark_item_completed`.
#[derive(Debug)]
pub struct AgentMessagePartialState {
    in_flight: Option<InFlight>,
    last_emit_ms: Option<i64>,
    pub emit_interval_ms: i64,
    /// Agent-message item ids completed this turn — a late/duplicate delta
    /// for one of these must not restart it.
    completed_this_turn: HashSet<String>,
}

impl Default for AgentMessagePartialState {
    fn default() -> Self {
        Self {
            in_flight: None,
            last_emit_ms: None,
            emit_interval_ms: PARTIAL_EMIT_INTERVAL_MS,
            completed_this_turn: HashSet::new(),
        }
    }
}

impl AgentMessagePartialState {
    /// Full reset: kill, process exit, or a turn ending (any status,
    /// including `failed`/`interrupted`) — no delta may survive across it.
    pub fn clear(&mut self) {
        self.in_flight = None;
        self.last_emit_ms = None;
        self.completed_this_turn.clear();
    }

    /// `item_id` materialized as a completed message. Blocks any later
    /// duplicate/stale delta for it this turn; when it is also the in-flight
    /// item AND `thread_id` matches (or the completion carries none), drops
    /// the in-flight text so a stray late delta cannot resurrect it under a
    /// mismatched thread.
    pub(crate) fn mark_item_completed(&mut self, item_id: &str, thread_id: Option<&str>) {
        self.completed_this_turn.insert(item_id.to_string());
        let is_in_flight = self
            .in_flight
            .as_ref()
            .is_some_and(|f| f.item_id == item_id && thread_id.is_none_or(|t| f.thread_id == t));
        if is_in_flight {
            self.in_flight = None;
        }
    }

    /// Appends `delta`'s text to the in-flight accumulation, restarting it
    /// when the `(thread, turn, item)` key changes, and returns `(item_id,
    /// text)` to emit when the text is non-empty and the emission gate open.
    fn accumulate(&mut self, delta: AgentMessageDeltaParams) -> Option<(String, String)> {
        let is_new_key = self.in_flight.as_ref().is_none_or(|f| {
            f.thread_id != delta.thread_id
                || f.turn_id != delta.turn_id
                || f.item_id != delta.item_id
        });
        if is_new_key {
            self.in_flight = Some(InFlight {
                thread_id: delta.thread_id,
                turn_id: delta.turn_id,
                item_id: delta.item_id,
                text: String::new(),
            });
            self.last_emit_ms = None;
        }
        let in_flight = self.in_flight.as_mut()?;
        in_flight.text.push_str(&delta.delta);
        if in_flight.text.is_empty() {
            return None;
        }
        let now = now_ms();
        if !emit_due(self.last_emit_ms, self.emit_interval_ms, now) {
            return None;
        }
        self.last_emit_ms = Some(now);
        Some((in_flight.item_id.clone(), in_flight.text.clone()))
    }
}

/// Dispatched from `event_mapper::handle_notification`'s
/// `"item/agentMessage/delta"` arm. Drops the delta when: the payload is
/// malformed, `itemId` is empty, the thread does not resolve to the parent,
/// it is not the parent's current turn, or the item already completed this
/// turn.
pub(crate) fn handle_agent_message_delta(
    params: &Value,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    let Ok(delta) = serde_json::from_value::<AgentMessageDeltaParams>(params.clone()) else {
        return;
    };
    if delta.item_id.is_empty() {
        return;
    }
    if !matches!(
        resolve_owner(Some(delta.thread_id.as_str()), state),
        Owner::Parent
    ) {
        return;
    }
    if state.current_turn_id.as_deref() != Some(delta.turn_id.as_str()) {
        return;
    }
    if state
        .agent_message_partial
        .completed_this_turn
        .contains(&delta.item_id)
    {
        return;
    }
    let presentation = state
        .presentation
        .partial(&delta.thread_id, &delta.turn_id, &delta.item_id);
    if let Some((item_id, text)) = state.agent_message_partial.accumulate(delta) {
        let content = vec![text_block(&text)];
        match presentation {
            Some(p) => sink.on_message_partial_with_presentation(&item_id, content, p),
            None => sink.on_message_partial(&item_id, content),
        }
    }
}

/// Should a delta at `now_ms` emit, given the last emission? First delta of
/// a message always does (`last` is `None`).
fn emit_due(last: Option<i64>, interval_ms: i64, now_ms: i64) -> bool {
    last.is_none_or(|last| now_ms - last >= interval_ms)
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
