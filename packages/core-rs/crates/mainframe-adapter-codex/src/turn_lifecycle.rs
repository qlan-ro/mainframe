//! Moved out of `event_mapper.rs` (task 1, todo #247) to keep that file under
//! the 300-line ceiling. Turn-scoped notification handlers, unchanged.

use std::sync::Arc;

use mainframe_adapter_api::SessionSink;
use mainframe_types::adapter::{MessageUsage, SessionResult};

use crate::session_state::{CodexSessionState, CurrentTurnPlan, LastUsage};
use crate::types::{
    PlanDeltaParams, TokenUsageUpdatedParams, TurnCompletedParams, TurnStartedParams,
};

pub(crate) fn handle_turn_started(params: TurnStartedParams, state: &mut CodexSessionState) {
    state.current_turn_plan = None;
    state.current_turn_id = Some(params.turn.id);
    state.compaction_emitted = false;
}

pub(crate) fn handle_plan_delta(params: PlanDeltaParams, state: &mut CodexSessionState) {
    let PlanDeltaParams { item_id, delta } = params;
    let text = match &state.current_turn_plan {
        Some(prev) if prev.id == item_id => format!("{}{}", prev.text, delta),
        _ => delta,
    };
    state.current_turn_plan = Some(CurrentTurnPlan { id: item_id, text });
}

pub(crate) fn handle_turn_completed(
    params: TurnCompletedParams,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    state.current_turn_plan = None;
    state.current_turn_id = None;
    let turn = params.turn;
    let is_error = turn.status == "failed" || turn.status == "interrupted";

    if is_error {
        tracing::warn!(
            module = "codex:events",
            turn_id = %turn.id,
            status = %turn.status,
            reason = turn.error.as_ref().map(|e| e.message.as_str()).unwrap_or(""),
            "codex: turn ended in error"
        );
    }

    let usage = state.last_usage.as_ref().map(|lu| MessageUsage {
        input_tokens: Some(lu.input_tokens),
        output_tokens: Some(lu.output_tokens),
        cache_creation_input_tokens: None,
        cache_read_input_tokens: lu.cache_read_input_tokens,
    });
    sink.on_result(SessionResult {
        total_cost_usd: Some(0.0),
        usage,
        // Codex has no distinct per-turn context total (#423 is Claude-only), so it
        // resolves the sink's `contextTokens === undefined → fall back to usage`
        // path (event-handler.ts:366) at the adapter boundary: report this turn's
        // raw input usage as the context size. None (no usage yet) keeps the stored
        // size. Option<i64> can't carry the TS undefined/null distinction downstream.
        context_tokens: state.last_usage.as_ref().map(|lu| lu.input_tokens),
        subtype: if is_error {
            Some("error_during_execution".to_string())
        } else {
            None
        },
        is_error: Some(is_error),
        result: turn.error.map(|e| e.message),
    });
    state.last_usage = None;
}

pub(crate) fn handle_token_usage(params: TokenUsageUpdatedParams, state: &mut CodexSessionState) {
    state.last_usage = Some(LastUsage {
        input_tokens: params.usage.input_tokens,
        output_tokens: params.usage.output_tokens,
        cache_read_input_tokens: params.usage.cached_input_tokens,
    });
}
