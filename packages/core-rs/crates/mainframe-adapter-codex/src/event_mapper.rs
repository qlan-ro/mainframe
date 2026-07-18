//! Ported from `packages/core/src/plugins/builtin/codex/event-mapper.ts`.
//!
//! Maps Codex app-server notifications onto `SessionSink` callbacks. Every
//! notification method is dispatched identically to the TS `handleNotification`;
//! unknown methods are logged at debug and skipped (never a hard error).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use mainframe_adapter_api::SessionSink;
use mainframe_types::adapter::{MessageMetadata, MessageUsage, SessionResult};
use mainframe_types::chat::{MessageContent, TodoItem, TodoStatus};
use serde_json::Value;

use crate::history::{
    bash_input, collab_agent_tool_use, file_change_input, image_block, is_exec_error,
    mcp_result_content, parse_unified_diff, reasoning_text, text_block, thinking_block,
    tool_result_block, tool_use_block, with_parent,
};
use crate::item_types::{CollabAgentToolCallItem, ThreadItem, TodoListItem};
use crate::quota_rate_limit::normalize_rate_limit_snapshot;
use crate::thread_registry::{agent_title, describe_agent, lookup_agent_metadata};
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
        "thread/compacted" => sink.on_compact(),
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
    sink.on_provider_quota("codex", quota);
}

fn handle_turn_started(params: TurnStartedParams, state: &mut CodexSessionState) {
    state.current_turn_plan = None;
    state.current_turn_id = Some(params.turn.id);
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
    let Ok(ThreadItem::CollabAgentToolCall(item)) =
        serde_json::from_value::<ThreadItem>(params.item)
    else {
        return;
    };
    // `spawnAgent` is dispatch metadata only — stash its prompt for the later `wait` card.
    if item.tool == "spawnAgent" {
        stash_spawn_prompts(&item, state);
        return;
    }
    // Only `wait` items render a card.
    emit_collab_task_group_start(&item, sink, state);
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
        wrapped = Arc::new(ParentIdSink {
            inner: sink.clone(),
            parent: pid,
        });
        &wrapped
    } else {
        sink
    };

    // Plan items arrive as a terminal `item/completed` with type === 'plan' (not
    // part of the ThreadItem union) — branch defensively before typed dispatch.
    let item = &params.item;
    if item.get("type").and_then(|v| v.as_str()) == Some("plan")
        && let (Some(text), Some(id)) = (
            item.get("text").and_then(|v| v.as_str()),
            item.get("id").and_then(|v| v.as_str()),
        )
    {
        state.current_turn_plan = Some(CurrentTurnPlan {
            id: id.to_string(),
            text: text.to_string(),
        });
        return;
    }

    let item: ThreadItem = match serde_json::from_value(params.item.clone()) {
        Ok(i) => i,
        Err(_) => {
            tracing::debug!(
                module = "codex:events",
                r#type = item.get("type").and_then(|v| v.as_str()).unwrap_or(""),
                "codex: unhandled item type"
            );
            return;
        }
    };

    match item {
        ThreadItem::AgentMessage(m) => sink.on_message(vec![text_block(&m.text)], None),
        ThreadItem::Reasoning(r) => {
            sink.on_message(
                vec![thinking_block(&reasoning_text(&r.summary, &r.content))],
                None,
            );
        }
        ThreadItem::CommandExecution(c) => {
            sink.on_message(
                vec![tool_use_block(&c.id, "Bash", bash_input(&c.command))],
                None,
            );
            sink.on_tool_result(vec![tool_result_block(
                &c.id,
                &c.aggregated_output,
                is_exec_error(c.exit_code),
                None,
            )]);
        }
        ThreadItem::FileChange(f) => {
            let is_completed = f.status != "inProgress";
            let is_error = f.status == "failed" || f.status == "declined";
            for (index, change) in f.changes.iter().enumerate() {
                let tool_id = format!("{}:{}", f.id, index);
                let is_add = matches!(change.kind, crate::item_types::PatchChangeKind::Add);
                let tool_name = if is_add { "Write" } else { "Edit" };
                let input = file_change_input(is_add, &change.path, &change.diff, &change.kind);
                sink.on_message(vec![tool_use_block(&tool_id, tool_name, input)], None);
                if is_completed {
                    let sp = parse_unified_diff(&change.diff);
                    let sp = if sp.is_empty() { None } else { Some(sp) };
                    sink.on_tool_result(vec![tool_result_block(&tool_id, "OK", is_error, sp)]);
                }
            }
        }
        ThreadItem::ImageGeneration(img) => handle_image_generation(img, sink),
        ThreadItem::CollabAgentToolCall(item) => handle_collab_completed(item, sink, state),
        ThreadItem::McpToolCall(m) => {
            let server = m.server.as_deref().unwrap_or("codex");
            let tool_name = format!("mcp__{server}__{}", m.tool);
            sink.on_message(
                vec![tool_use_block(&m.id, &tool_name, m.arguments.clone())],
                None,
            );
            let content =
                mcp_result_content(m.result.as_ref().map(|r| &r.content), m.error.as_ref());
            sink.on_tool_result(vec![tool_result_block(
                &m.id,
                &content,
                m.error.is_some(),
                None,
            )]);
        }
        ThreadItem::TodoList(item) => {
            let todos = normalize_todo_list_items(&item);
            if !todos.is_empty() {
                sink.on_todo_update(todos);
            }
        }
        _ => {
            tracing::debug!(module = "codex:events", "codex: unhandled item type");
        }
    }
}

fn handle_image_generation(
    img: crate::item_types::ImageGenerationItem,
    sink: &Arc<dyn SessionSink>,
) {
    let prompt = img.revised_prompt.filter(|p| !p.is_empty());
    if let Some(inline) = img.result {
        let media = media_type_from_extension(img.saved_path.as_deref().unwrap_or(".png"));
        emit_image(sink, prompt.as_deref(), &media, &inline);
        return;
    }
    let Some(path) = img.saved_path else {
        tracing::warn!(module = "codex:events", id = %img.id, "codex: imageGeneration missing both result and savedPath");
        return;
    };
    // Read the saved image off disk asynchronously, then emit.
    let sink = sink.clone();
    tokio::spawn(async move {
        match tokio::fs::read(&path).await {
            Ok(bytes) => {
                let media = media_type_from_extension(&path);
                emit_image(&sink, prompt.as_deref(), &media, &base64_encode(&bytes));
            }
            Err(err) => {
                tracing::warn!(module = "codex:events", err = %err, path, "codex: failed to read generated image");
            }
        }
    });
}

fn emit_image(sink: &Arc<dyn SessionSink>, prompt: Option<&str>, media_type: &str, data: &str) {
    let mut content: Vec<MessageContent> = vec![image_block(media_type, data)];
    if let Some(p) = prompt {
        content.insert(0, text_block(p));
    }
    sink.on_message(content, None);
}

fn handle_collab_completed(
    item: CollabAgentToolCallItem,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    // `spawnAgent` is dispatch metadata only — stash its prompt for the `wait` card.
    if item.tool == "spawnAgent" {
        stash_spawn_prompts(&item, state);
        return;
    }
    // `wait` is the renderable card — open it (if started didn't) and close with the result.
    if !state.open_collab_cards.contains(&item.id) {
        emit_collab_task_group_start(&item, sink, state);
    }
    let child_id = item
        .receiver_thread_ids
        .as_ref()
        .and_then(|ids| ids.first());
    let sub_agent_message = child_id
        .and_then(|c| item.agents_states.as_ref().and_then(|s| s.get(c)))
        .and_then(|s| s.message.clone());
    let is_error = item.status == "failed" || item.status == "interrupted";
    let content = sub_agent_message.unwrap_or_else(|| "Sub-agent completed".to_string());
    sink.on_tool_result(vec![tool_result_block(&item.id, &content, is_error, None)]);
    state.open_collab_cards.remove(&item.id);
    // Stop routing further items from this spawn's child thread(s) and drop the prompt.
    if let Some(children) = &item.receiver_thread_ids {
        for cid in children {
            state.collab_child_threads.remove(cid);
            state.spawn_prompts.remove(cid);
        }
    }
}

fn stash_spawn_prompts(item: &CollabAgentToolCallItem, state: &mut CodexSessionState) {
    if let (Some(children), Some(prompt)) = (&item.receiver_thread_ids, &item.prompt) {
        for child_id in children {
            state.spawn_prompts.insert(child_id.clone(), prompt.clone());
        }
    }
}

fn normalize_todo_list_items(item: &TodoListItem) -> Vec<TodoItem> {
    item.items
        .iter()
        .map(|t| TodoItem {
            content: t.text.clone(),
            status: if t.completed {
                TodoStatus::Completed
            } else {
                TodoStatus::Pending
            },
            active_form: t.text.clone(),
        })
        .collect()
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

fn media_type_from_extension(path: &str) -> String {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn emit_collab_task_group_start(
    item: &CollabAgentToolCallItem,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    state.open_collab_cards.insert(item.id.clone());
    // Register the spawned thread(s) so subsequent child items get tagged.
    if let Some(children) = &item.receiver_thread_ids {
        for child_id in children {
            state
                .collab_child_threads
                .insert(child_id.clone(), item.id.clone());
        }
    }
    let child_id = item
        .receiver_thread_ids
        .as_ref()
        .and_then(|ids| ids.first());
    // Same identity mapping as history.rs — subagent_type is the nickname,
    // description is the spawn prompt (more informative than the bare role).
    let meta = child_id.and_then(|c| lookup_agent_metadata(std::slice::from_ref(c)).remove(c));
    let subagent_type = agent_title(meta.as_ref())
        .or_else(|| describe_agent(meta.as_ref()))
        .unwrap_or_else(|| "Sub-agent".to_string());
    let prompt = child_id
        .and_then(|c| state.spawn_prompts.get(c).cloned())
        .or_else(|| item.prompt.clone())
        .unwrap_or_default();
    let description = describe_agent(meta.as_ref()).unwrap_or_else(|| {
        if prompt.is_empty() {
            subagent_type.clone()
        } else {
            prompt.clone()
        }
    });
    sink.on_message(
        vec![collab_agent_tool_use(
            &item.id,
            &prompt,
            &description,
            &subagent_type,
        )],
        None,
    );
}

/// Wraps a sink to tag every emitted block with `parentToolUseId` (mirrors the TS
/// `wrapSinkWithParentId`). Only `on_message`/`on_tool_result` are transformed;
/// every other callback delegates unchanged.
struct ParentIdSink {
    inner: Arc<dyn SessionSink>,
    parent: String,
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

/// Minimal standard base64 encoder (no base64 crate in the allowlist), used only
/// for the `imageGeneration` savedPath disk-read fallback.
fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;
        out.push(TABLE[b0 >> 2] as char);
        out.push(TABLE[((b0 & 0x03) << 4) | (b1 >> 4)] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((b1 & 0x0f) << 2) | (b2 >> 6)] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[b2 & 0x3f] as char
        } else {
            '='
        });
    }
    out
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
