//! Maps Codex app-server notifications onto `SessionSink` callbacks.

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
        "thread/started" => decode(params, |p: ThreadStartedParams| {
            handle_thread_started(p, sink, state)
        }),
        "turn/started" => decode(params, |p: TurnStartedParams| handle_turn_started(p, state)),
        "item/completed" => decode(params, |p: ItemCompletedParams| {
            handle_item_completed(p, sink, state)
        }),
        "item/started" => decode(params, |p: ItemStartedParams| {
            handle_item_started(p, sink, state)
        }),
        "item/plan/delta" => decode(params, |p: PlanDeltaParams| handle_plan_delta(p, state)),
        "turn/completed" => decode(params, |p: TurnCompletedParams| {
            handle_turn_completed(p, sink, state)
        }),
        "thread/tokenUsage/updated" => decode(params, |p: TokenUsageUpdatedParams| {
            handle_token_usage(p, sink, state)
        }),
        "thread/compacted" => crate::compaction::handle_compaction_completed(sink, state, None),
        "account/rateLimits/updated" => decode(params, |p: AccountRateLimitsUpdatedParams| {
            handle_account_rate_limits_updated(p, sink)
        }),
        "item/agentMessage/delta" => {
            crate::agent_message_partial::handle_agent_message_delta(params, sink, state)
        }
        _ => handle_unmapped(method),
    }
}
fn decode<T: serde::de::DeserializeOwned>(params: &Value, handle: impl FnOnce(T)) {
    if let Ok(p) = serde_json::from_value(params.clone()) {
        handle(p);
    }
}
fn handle_unmapped(method: &str) {
    match method {
        "turn/diff/updated"
        | "turn/plan/updated"
        | "thread/closed"
        | "thread/status/changed"
        | "item/commandExecution/outputDelta"
        | "item/fileChange/outputDelta"
        | "item/reasoning/summaryTextDelta"
        | "item/reasoning/textDelta"
        | "thread/name/updated" => {}
        _ if method.starts_with("codex/event/") => {}
        _ => tracing::debug!(
            module = "codex:events",
            method,
            "codex: unhandled notification"
        ),
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

/// Which session a notification's `threadId` belongs to:
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
    let _ = presentation_for_item(
        params.thread_id.as_deref(),
        params.turn_id.as_deref(),
        &params.item,
        false,
        sink.as_ref(),
        state,
    );
    let sink = &sink;

    match serde_json::from_value::<ThreadItem>(params.item) {
        Ok(ThreadItem::CommandExecution(item)) => {
            let thread = params
                .thread_id
                .as_deref()
                .or(state.thread_id.as_deref())
                .unwrap_or_default();
            state
                .command_state
                .started(thread, params.turn_id.as_deref(), &item);
        }
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
    let contextual = presentation_for_item(
        params.thread_id.as_deref(),
        params.turn_id.as_deref(),
        &params.item,
        true,
        sink.as_ref(),
        state,
    );
    if contextual.as_ref().is_some_and(|(_, duplicate)| *duplicate) {
        return;
    }
    let sink = contextual
        .map(|(p, _)| crate::presentation_sink::PresentationSink::wrap(sink.clone(), p))
        .unwrap_or(sink);
    let sink = &sink;

    // Plan deltas only ever describe the parent's own turn — a child's plan item
    // falls through to the unhandled-item-type debug log below instead.
    if matches!(owner, Owner::Parent)
        && let Some((id, text)) = plan_item_fields(&params.item)
    {
        state.current_turn_plan = Some(crate::session_state::CurrentTurnPlan { id, text });
        return;
    }

    render_completed(params, sink, state);
}
fn render_completed(
    params: ItemCompletedParams,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    match serde_json::from_value::<ThreadItem>(params.item.clone()) {
        Ok(mut item) => {
            if let ThreadItem::CommandExecution(command) = &mut item {
                let thread = params
                    .thread_id
                    .as_deref()
                    .or(state.thread_id.as_deref())
                    .unwrap_or_default();
                state
                    .command_state
                    .complete(thread, params.turn_id.as_deref(), command);
            }
            render_completed_item(item, params.thread_id.as_deref(), sink, state);
        }
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

fn presentation_for_item(
    thread: Option<&str>,
    turn: Option<&str>,
    item: &Value,
    completed: bool,
    sink: &dyn SessionSink,
    state: &mut CodexSessionState,
) -> Option<(
    mainframe_types::transcript_presentation::TranscriptPresentation,
    bool,
)> {
    let (thread, turn) = (thread?, turn?);
    let parent = match resolve_owner(Some(thread), state) {
        Owner::Parent if state.thread_id.as_deref() == Some(thread) => None,
        Owner::Child(t) => state.card_for_thread(&t).map(|c| c.card_id.clone()),
        _ => return None,
    };
    state.presentation.ensure(thread, turn, parent);
    state.presentation.item(thread, turn, item, completed, sink)
}
