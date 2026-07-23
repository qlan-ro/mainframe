//! Ported from `packages/core/src/plugins/builtin/codex/event-mapper.ts`.
//!
//! Maps Codex app-server notifications onto `SessionSink` callbacks. Every
//! notification method is dispatched identically to the TS `handleNotification`;
//! unknown methods are logged at debug and skipped (never a hard error).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use mainframe_adapter_api::SessionSink;
use mainframe_types::adapter::{MessageMetadata, MessageUsage, SessionResult};
use mainframe_types::chat::{MessageContent, TodoItem};
use serde_json::Value;

use crate::history::with_parent;
use crate::item_types::ThreadItem;
use crate::quota_rate_limit::{
    has_recognized_window, normalize_rate_limit_snapshot, snapshot_has_window,
};
use crate::thread_item_render::{
    emit_collab_task_group_start, render_completed_item, stash_spawn_prompts,
};
use crate::types::{
    AccountRateLimitsUpdatedParams, ItemCompletedParams, ItemStartedParams, PlanDeltaParams,
    ThreadStartedParams, TokenUsageUpdatedParams, TurnCompletedParams, TurnStartedParams,
};

/// The `{ id, text }` plan captured incrementally across a turn.
#[derive(Debug, Clone, PartialEq)]
pub struct CurrentTurnPlan {
    pub id: String,
    pub text: String,
}

/// Last token-usage snapshot, carried into the terminal `turn/completed` result.
#[derive(Debug, Clone, PartialEq)]
pub struct LastUsage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_input_tokens: Option<i64>,
}

/// Per-session mutable state driven by the notification stream (SINGLE_TASK per
/// CONCURRENCY.tsv row 95 — owned by the session actor). The lazily-created TS
/// `Set`/`Map` fields become always-present empty collections here.
#[derive(Debug, Default)]
pub struct CodexSessionState {
    pub thread_id: Option<String>,
    pub current_turn_id: Option<String>,
    pub current_turn_plan: Option<CurrentTurnPlan>,
    pub last_usage: Option<LastUsage>,
    /// collabAgentToolCall item ids that already had a CollabAgent tool_use emitted.
    pub open_collab_cards: HashSet<String>,
    /// child thread id → parent CollabAgent tool_use id.
    pub collab_child_threads: HashMap<String, String>,
    /// child thread id → spawn prompt (captured from `spawnAgent` items).
    pub spawn_prompts: HashMap<String, String>,
    /// Per-turn dedupe: compact-done already emitted (item or legacy `thread/compacted` path).
    pub compaction_emitted: bool,
    /// CollabAgent tool_use ids already resolved to an errored state by an
    /// `interrupted` `subAgentActivity` ping, ahead of the card's own completion.
    pub errored_collab_cards: HashSet<String>,
    /// child thread id → the live rollout-tail task streaming that child's work
    /// into the TaskCard, plus its cancellation handle (stopped on wait completion).
    pub child_tails: HashMap<String, (tokio::task::JoinHandle<()>, tokio_util::sync::CancellationToken)>,
}

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

fn handle_turn_started(params: TurnStartedParams, state: &mut CodexSessionState) {
    state.current_turn_plan = None;
    state.current_turn_id = Some(params.turn.id);
    state.compaction_emitted = false;
}

fn handle_plan_delta(params: PlanDeltaParams, state: &mut CodexSessionState) {
    let PlanDeltaParams { item_id, delta } = params;
    let text = match &state.current_turn_plan {
        Some(prev) if prev.id == item_id => format!("{}{}", prev.text, delta),
        _ => delta,
    };
    state.current_turn_plan = Some(CurrentTurnPlan { id: item_id, text });
}

fn handle_item_started(
    params: ItemStartedParams,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    match serde_json::from_value::<ThreadItem>(params.item) {
        Ok(ThreadItem::ContextCompaction(_)) => {
            crate::compaction::handle_compaction_started(sink);
        }
        Ok(ThreadItem::CollabAgentToolCall(item)) => {
            // `spawnAgent` is dispatch metadata only — stash its prompt for the later `wait` card.
            if item.tool == "spawnAgent" {
                stash_spawn_prompts(&item, state);
                return;
            }
            // Only `wait` items render a card.
            emit_collab_task_group_start(&item, sink, state);
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
    // If this item came from a spawned sub-agent's thread, tag emitted blocks with
    // the parent CollabAgent's tool_use id so the renderer nests them.
    let parent_tool_use_id = params
        .thread_id
        .as_ref()
        .and_then(|tid| state.collab_child_threads.get(tid).cloned());
    let wrapped: Arc<dyn SessionSink>;
    let sink: &Arc<dyn SessionSink> = if let Some(pid) = parent_tool_use_id {
        wrapped = Arc::new(ParentIdSink::new(sink.clone(), pid));
        &wrapped
    } else {
        sink
    };

    if let Some((id, text)) = plan_item_fields(&params.item) {
        state.current_turn_plan = Some(CurrentTurnPlan { id, text });
        return;
    }

    match serde_json::from_value::<ThreadItem>(params.item.clone()) {
        Ok(item) => render_completed_item(item, sink, state),
        Err(_) => {
            tracing::debug!(
                module = "codex:events",
                r#type = params.item.get("type").and_then(|v| v.as_str()).unwrap_or(""),
                "codex: unhandled item type"
            );
        }
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

fn handle_turn_completed(
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

fn handle_token_usage(params: TokenUsageUpdatedParams, state: &mut CodexSessionState) {
    state.last_usage = Some(LastUsage {
        input_tokens: params.usage.input_tokens,
        output_tokens: params.usage.output_tokens,
        cache_read_input_tokens: params.usage.cached_input_tokens,
    });
}

/// Wraps a sink to tag every emitted block with `parentToolUseId` (mirrors the TS
/// `wrapSinkWithParentId`). Only `on_message`/`on_tool_result` are transformed;
/// every other callback delegates unchanged. `pub(crate)` so `child_tail.rs` can
/// wrap a raw sink before streaming reconstructed child items into it.
pub(crate) struct ParentIdSink {
    inner: Arc<dyn SessionSink>,
    parent: String,
}

impl ParentIdSink {
    pub(crate) fn new(inner: Arc<dyn SessionSink>, parent: String) -> Self {
        Self { inner, parent }
    }
}

impl SessionSink for ParentIdSink {
    fn on_init(&self, session_id: &str) {
        self.inner.on_init(session_id);
    }
    fn on_message(&self, content: Vec<MessageContent>, metadata: Option<MessageMetadata>) {
        self.inner.on_message(
            content
                .into_iter()
                .map(|b| with_parent(b, &self.parent))
                .collect(),
            metadata,
        );
    }
    fn on_tool_result(&self, content: Vec<MessageContent>) {
        self.inner.on_tool_result(
            content
                .into_iter()
                .map(|b| with_parent(b, &self.parent))
                .collect(),
        );
    }
    fn on_permission(&self, request: mainframe_adapter_api::ControlRequest) {
        self.inner.on_permission(request);
    }
    fn on_result(&self, data: SessionResult) {
        self.inner.on_result(data);
    }
    fn on_exit(&self, code: Option<i32>) {
        self.inner.on_exit(code);
    }
    fn on_error(&self, error: mainframe_adapter_api::AdapterError) {
        self.inner.on_error(error);
    }
    fn on_compact(&self) {
        self.inner.on_compact();
    }
    fn on_compact_start(&self) {
        self.inner.on_compact_start();
    }
    fn on_context_usage(&self, usage: mainframe_types::adapter::ContextUsage) {
        self.inner.on_context_usage(usage);
    }
    fn on_plan_file(&self, file_path: &str) {
        self.inner.on_plan_file(file_path);
    }
    fn on_skill_file(&self, entry: mainframe_types::context::SkillFileEntry) {
        self.inner.on_skill_file(entry);
    }
    fn on_queued_processed(&self, uuid: &str) {
        self.inner.on_queued_processed(uuid);
    }
    fn on_todo_update(&self, todos: Vec<TodoItem>) {
        self.inner.on_todo_update(todos);
    }
    fn on_pr_detected(&self, pr: mainframe_types::adapter::DetectedPr) {
        self.inner.on_pr_detected(pr);
    }
    fn on_cli_message(&self, text: &str) {
        self.inner.on_cli_message(text);
    }
    fn on_skill_loaded(&self, entry: mainframe_adapter_api::LoadedSkill) {
        self.inner.on_skill_loaded(entry);
    }
    fn on_subagent_child(&self, parent_tool_use_id: &str, blocks: Vec<MessageContent>) {
        self.inner.on_subagent_child(parent_tool_use_id, blocks);
    }
    fn on_trust_required(&self, project_path: &str) {
        self.inner.on_trust_required(project_path);
    }
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
