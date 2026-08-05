//! Ported from `packages/core/src/plugins/builtin/codex/event-mapper.ts`.
//!
//! Maps Codex app-server notifications onto `SessionSink` callbacks. Every
//! notification method is dispatched identically to the TS `handleNotification`;
//! unknown methods are logged at debug and skipped (never a hard error).

use std::sync::Arc;

use mainframe_adapter_api::SessionSink;
use serde_json::Value;

use crate::collab_card;
use crate::item_types::ThreadItem;
pub(crate) use crate::parent_id_sink::ParentIdSink;
use crate::quota_rate_limit::{
    has_recognized_window, normalize_rate_limit_snapshot, snapshot_has_window,
};
pub use crate::session_state::{CodexSessionState, CurrentTurnPlan, LastUsage};
use crate::thread_item_render::render_completed_item;
use crate::turn_lifecycle::{
    handle_plan_delta, handle_token_usage, handle_turn_completed, handle_turn_started,
};
use crate::types::{
    AccountRateLimitsUpdatedParams, ItemCompletedParams, ItemStartedParams, PlanDeltaParams,
    ThreadStartedParams, TokenUsageUpdatedParams, TurnCompletedParams, TurnStartedParams,
};

pub fn handle_notification(
    method: &str,
    params: &Value,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    tracing::debug!(module = "codex:events", method, "codex notification");

    match method {
        "thread/started" => {
            if let Ok(p) = serde_json::from_value::<ThreadStartedParams>(params.clone()) {
                handle_thread_started(p, sink, state);
            }
        }
        "turn/started" => {
            if let Ok(p) = serde_json::from_value::<TurnStartedParams>(params.clone()) {
                handle_turn_started(p, state);
            }
        }
        "item/completed" => {
            if let Ok(p) = serde_json::from_value::<ItemCompletedParams>(params.clone()) {
                handle_item_completed(p, sink, state);
            }
        }
        "item/plan/delta" => {
            if let Ok(p) = serde_json::from_value::<PlanDeltaParams>(params.clone()) {
                handle_plan_delta(p, state);
            }
        }
        "turn/completed" => {
            if let Ok(p) = serde_json::from_value::<TurnCompletedParams>(params.clone()) {
                handle_turn_completed(p, sink, state);
            }
        }
        "thread/tokenUsage/updated" => {
            if let Ok(p) = serde_json::from_value::<TokenUsageUpdatedParams>(params.clone()) {
                handle_token_usage(p, state);
            }
        }
        "thread/compacted" => crate::compaction::handle_compaction_completed(sink, state),
        "item/started" => {
            if let Ok(p) = serde_json::from_value::<ItemStartedParams>(params.clone()) {
                handle_item_started(p, sink, state);
            }
        }
        "account/rateLimits/updated" => {
            if let Ok(p) = serde_json::from_value::<AccountRateLimitsUpdatedParams>(params.clone())
            {
                handle_account_rate_limits_updated(p, sink);
            }
        }
        // Known-but-unhandled notifications — silently ignore.
        "turn/diff/updated"
        | "turn/plan/updated"
        | "thread/closed"
        | "thread/status/changed"
        | "item/agentMessage/delta"
        | "item/commandExecution/outputDelta"
        | "item/fileChange/outputDelta"
        | "item/reasoning/summaryTextDelta"
        | "item/reasoning/textDelta"
        | "thread/name/updated" => {}
        _ => {
            if method.starts_with("codex/event/") {
                return;
            }
            tracing::debug!(
                module = "codex:events",
                method,
                "codex: unhandled notification"
            );
        }
    }
}

fn handle_thread_started(
    params: ThreadStartedParams,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    state.thread_id = Some(params.thread.id.clone());
    sink.on_init(&params.thread.id);
}

fn handle_account_rate_limits_updated(
    params: AccountRateLimitsUpdatedParams,
    sink: &Arc<dyn SessionSink>,
) {
    let quota =
        normalize_rate_limit_snapshot(&params.rate_limits, chrono::Utc::now().timestamp_millis());
    // C2 (#268): a snapshot that recognizes zero windows must not ingest — it would
    // bump freshness with no data behind it. Warn only when slots were present but
    // unrecognized (a genuine format drift), staying quiet on a benign empty snapshot.
    if !has_recognized_window(&quota) {
        if snapshot_has_window(&params.rate_limits) {
            tracing::warn!(
                "codex rate limit: snapshot had windows but none were recognized; skipping ingest"
            );
        }
        return;
    }
    sink.on_provider_quota("codex", quota);
}

/// Which session a notification's `threadId` belongs to (task 17, todo #247):
/// the parent's own thread (or untagged, or pre-`thread/started`), a registered
/// child, or neither — an item from a thread nobody named must be dropped, not
/// leaked to the parent's transcript.
pub(crate) enum Owner {
    Parent,
    Child(String),
    Unknown,
}

pub(crate) fn resolve_owner(thread_id: Option<&str>, state: &CodexSessionState) -> Owner {
    if state.thread_id.is_none() {
        return Owner::Parent;
    }
    match thread_id {
        None => Owner::Parent,
        Some(tid) if state.thread_id.as_deref() == Some(tid) => Owner::Parent,
        Some(tid) if state.sub_agent_cards.contains_key(tid) => Owner::Child(tid.to_string()),
        Some(_) => Owner::Unknown,
    }
}

fn handle_item_started(
    params: ItemStartedParams,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    let owner = resolve_owner(params.thread_id.as_deref(), state);
    let Some(sink) = owner_sink(&owner, sink, state) else {
        return;
    };
    let sink = &sink;

    match serde_json::from_value::<ThreadItem>(params.item) {
        Ok(ThreadItem::ContextCompaction(_)) => {
            crate::compaction::handle_compaction_started(sink);
        }
        Ok(ThreadItem::CollabAgentToolCall(item)) => {
            collab_card::on_collab_tool_call(&item, collab_card::Phase::Started, sink, state);
        }
        // Every other item type renders from its terminal `item/completed` event.
        Ok(_) | Err(_) => {}
    }
}

fn handle_item_completed(
    params: ItemCompletedParams,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    let owner = resolve_owner(params.thread_id.as_deref(), state);
    let Some(sink) = owner_sink(&owner, sink, state) else {
        return;
    };
    let sink = &sink;

    // Plan deltas only ever describe the parent's own turn — a child's plan item
    // falls through to the unhandled-item-type debug log below instead.
    if matches!(owner, Owner::Parent)
        && let Some((id, text)) = plan_item_fields(&params.item)
    {
        state.current_turn_plan = Some(crate::session_state::CurrentTurnPlan { id, text });
        return;
    }

    match serde_json::from_value::<ThreadItem>(params.item.clone()) {
        Ok(item) => render_completed_item(item, params.thread_id.as_deref(), sink, state),
        Err(_) => {
            tracing::debug!(
                module = "codex:events",
                r#type = params
                    .item
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or(""),
                "codex: unhandled item type"
            );
        }
    }
}

/// Resolves an `Owner` into the sink an item/turn should render through:
/// `Unknown` drops the notification (returns `None`); `Child(t)` wraps `sink` in
/// a `ParentIdSink` tagged with that child's card id; `Parent` passes `sink`
/// through unchanged (cloning the `Arc`, not deep-copying the sink).
fn owner_sink(
    owner: &Owner,
    sink: &Arc<dyn SessionSink>,
    state: &CodexSessionState,
) -> Option<Arc<dyn SessionSink>> {
    match owner {
        Owner::Unknown => {
            tracing::debug!(
                module = "codex:events",
                "codex: dropping item from an unregistered thread"
            );
            None
        }
        Owner::Child(t) => {
            let card_id = state.sub_agent_cards.get(t)?.card_id.clone();
            Some(Arc::new(ParentIdSink::new(sink.clone(), card_id)))
        }
        Owner::Parent => Some(sink.clone()),
    }
}

/// Plan items arrive as a terminal `item/completed` with `type === "plan"` (not
/// part of the ThreadItem union) — checked before typed dispatch.
fn plan_item_fields(item: &Value) -> Option<(String, String)> {
    if item.get("type").and_then(|v| v.as_str()) != Some("plan") {
        return None;
    }
    let text = item.get("text").and_then(|v| v.as_str())?.to_string();
    let id = item.get("id").and_then(|v| v.as_str())?.to_string();
    Some((id, text))
}

// PORT STATUS: src/plugins/builtin/codex/event-mapper.ts (395 lines)
// confidence: medium
// todos: 0
// notes: handle_notification dispatches every method identically to the TS switch;
// notes: unknown methods debug-log once + skip. `wrapSinkWithParentId` becomes a
// notes: ParentIdSink newtype over Arc<dyn SessionSink> (delegates all callbacks;
// notes: transforms only on_message/on_tool_result). CodexSessionState uses
// notes: always-present empty HashSet/HashMap for the TS lazily-created Set/Map
// notes: fields. The imageGeneration savedPath disk-read fallback keeps the TS
// notes: async readFile via tokio::spawn + a hand-rolled base64 encoder (no base64
// notes: crate in the allowlist; inline path uses Codex's own base64 unchanged).
// notes: parse_unified_diff is the crate-local shim (see history.rs blocker note).
// notes: handle_turn_completed sends SessionResult.context_tokens = this turn's raw
// notes: input usage (None when no usage yet), resolving the TS sink's
// notes: `contextTokens === undefined → fall back to usage` path (event-handler.ts:366)
// notes: here because Option<i64> can't carry the undefined/null distinction downstream.
// notes: Tests in tests/event_mapper.rs (collab-agent-spawn + plan-item-capture +
// notes: turn-completed context/usage). `account/rateLimits/updated` moved out of
// notes: the silent-ignore arm into handle_account_rate_limits_updated, which
// notes: normalizes via quota_rate_limit and calls sink.on_provider_quota (no `?.`
// notes: needed — the trait's default no-op body covers sinks that don't override
// notes: it). Tested in tests/quota_notification.rs.
// notes: task 1 (todo #247) carved CodexSessionState/CurrentTurnPlan/LastUsage into
// notes: session_state.rs, ParentIdSink into parent_id_sink.rs, and the four turn/
// notes: usage/plan handlers into turn_lifecycle.rs; re-exported here so external
// notes: `event_mapper::X` call sites keep compiling.
