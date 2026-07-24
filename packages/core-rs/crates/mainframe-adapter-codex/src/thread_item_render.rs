//! Renders a completed `ThreadItem` into `SessionSink` calls. Moved out of
//! `event_mapper.rs`'s `handle_item_completed` (was ~117 lines, over the
//! 50-line ceiling) — the notification-dispatch shell stays in event_mapper.rs.

use std::collections::HashMap;
use std::sync::Arc;

use mainframe_adapter_api::SessionSink;
use mainframe_types::chat::{TodoItem, TodoStatus};
use tokio_util::sync::CancellationToken;

use crate::child_tail::spawn_child_tail;
use crate::event_mapper::CodexSessionState;
use crate::history::{
    bash_input, collab_agent_tool_use, file_change_input, is_exec_error, mcp_result_content,
    parse_unified_diff, reasoning_text, text_block, thinking_block, tool_result_block,
    tool_use_block,
};
use crate::image_generation_render::handle_image_generation;
use crate::item_types::{
    CollabAgentToolCallItem, CommandExecutionItem, DynamicToolCallItem, FileChangeItem,
    McpToolCallItem, ReasoningItem, SubAgentActivityItem, ThreadItem, TodoListItem,
};
use crate::thread_registry::{AgentMetadata, agent_title, describe_agent, lookup_agent_metadata};
use crate::web_search_render::render_web_search;

/// Dispatches one parsed `ThreadItem` from `item/completed` to the sink. `sink` is
/// already wrapped with `ParentIdSink` by the caller when the item belongs to a
/// spawned sub-agent's thread.
pub(crate) fn render_completed_item(
    item: ThreadItem,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    match item {
        ThreadItem::AgentMessage(m) => sink.on_message(vec![text_block(&m.text)], None),
        ThreadItem::Reasoning(r) => render_reasoning(&r, sink),
        ThreadItem::CommandExecution(c) => render_command_execution(&c, sink),
        ThreadItem::FileChange(f) => render_file_change(&f, sink),
        ThreadItem::ImageGeneration(img) => handle_image_generation(img, sink),
        ThreadItem::CollabAgentToolCall(item) => handle_collab_completed(item, sink, state),
        ThreadItem::McpToolCall(m) => render_mcp_tool_call(&m, sink),
        ThreadItem::TodoList(item) => render_todo_list(&item, sink),
        ThreadItem::ContextCompaction(_) => {
            crate::compaction::handle_compaction_completed(sink, state);
        }
        ThreadItem::DynamicToolCall(d) => render_dynamic_tool_call(&d, sink),
        ThreadItem::EnteredReviewMode(_) => skip_item("enteredReviewMode"),
        ThreadItem::ExitedReviewMode(_) => skip_item("exitedReviewMode"),
        ThreadItem::ImageView(_) => skip_item("imageView"),
        ThreadItem::Sleep(_) => skip_item("sleep"),
        ThreadItem::HookPrompt(_) => skip_item("hookPrompt"),
        ThreadItem::SubAgentActivity(a) => handle_sub_agent_activity(&a, sink, state),
        ThreadItem::WebSearch(w) => render_web_search(&w, sink),
        ThreadItem::UserMessage(_) => {
            tracing::debug!(module = "codex:events", "codex: unhandled item type");
        }
    }
}

fn skip_item(name: &str) {
    tracing::debug!(
        module = "codex:events",
        item = name,
        "skipping unrendered thread item"
    );
}

fn dynamic_tool_call_name(d: &DynamicToolCallItem) -> String {
    match d.namespace.as_deref().filter(|ns| !ns.is_empty()) {
        Some(ns) => format!("{ns}__{}", d.tool),
        None => d.tool.clone(),
    }
}

fn dynamic_tool_call_input(arguments: &serde_json::Value) -> HashMap<String, serde_json::Value> {
    match arguments.as_object() {
        Some(map) => map.clone().into_iter().collect(),
        None if arguments.is_null() => HashMap::new(),
        None => HashMap::from([("arguments".to_string(), arguments.clone())]),
    }
}

fn render_dynamic_tool_call(d: &DynamicToolCallItem, sink: &Arc<dyn SessionSink>) {
    let name = dynamic_tool_call_name(d);
    let input = dynamic_tool_call_input(&d.arguments);
    sink.on_message(vec![tool_use_block(&d.id, &name, input)], None);
}

fn render_reasoning(r: &ReasoningItem, sink: &Arc<dyn SessionSink>) {
    sink.on_message(
        vec![thinking_block(&reasoning_text(&r.summary, &r.content))],
        None,
    );
}

fn render_command_execution(c: &CommandExecutionItem, sink: &Arc<dyn SessionSink>) {
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

fn render_file_change(f: &FileChangeItem, sink: &Arc<dyn SessionSink>) {
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

fn render_mcp_tool_call(m: &McpToolCallItem, sink: &Arc<dyn SessionSink>) {
    let server = m.server.as_deref().unwrap_or("codex");
    let tool_name = format!("mcp__{server}__{}", m.tool);
    sink.on_message(
        vec![tool_use_block(&m.id, &tool_name, m.arguments.clone())],
        None,
    );
    let content = mcp_result_content(m.result.as_ref().map(|r| &r.content), m.error.as_ref());
    sink.on_tool_result(vec![tool_result_block(
        &m.id,
        &content,
        m.error.is_some(),
        None,
    )]);
}

fn render_todo_list(item: &TodoListItem, sink: &Arc<dyn SessionSink>) {
    let todos = normalize_todo_list_items(item);
    if !todos.is_empty() {
        sink.on_todo_update(todos);
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
    // An `interrupted` subAgentActivity ping may have already closed this card with
    // an error result; don't re-open the start block or double-emit the result.
    let already_errored = state.errored_collab_cards.remove(&item.id);
    if !already_errored {
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
    }
    state.open_collab_cards.remove(&item.id);
    // Stop routing further items from this spawn's child thread(s) and drop the prompt.
    if let Some(children) = &item.receiver_thread_ids {
        for cid in children {
            state.collab_child_threads.remove(cid);
            state.spawn_prompts.remove(cid);
            // Signal-only: the tail observes this on its own next tick and exits, so a
            // completed wait never races a late batch onto an already-closed card. The
            // handle is dropped, not aborted — the task still gets to return cleanly.
            if let Some((_, cancel)) = state.child_tails.remove(cid) {
                cancel.cancel();
            }
        }
    }
}

/// `started`/`interacted` pings have nothing to update (the TaskCard carries no
/// status field beyond `isError`/`isRunning`); `interrupted` resolves the parent
/// CollabAgent card to an errored state early, ahead of its own `wait` completion.
fn handle_sub_agent_activity(
    item: &SubAgentActivityItem,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    if item.kind != "interrupted" {
        tracing::debug!(
            module = "codex:events",
            kind = %item.kind,
            "codex: subAgentActivity ping has no TaskCard effect"
        );
        return;
    }
    let Some(parent_id) = state.collab_child_threads.get(&item.agent_thread_id).cloned() else {
        tracing::debug!(
            module = "codex:events",
            agent_thread_id = %item.agent_thread_id,
            "codex: interrupted subAgentActivity for an unregistered agent thread"
        );
        return;
    };
    sink.on_tool_result(vec![tool_result_block(
        &parent_id,
        "Sub-agent interrupted",
        true,
        None,
    )]);
    state.errored_collab_cards.insert(parent_id);
}

pub(crate) fn stash_spawn_prompts(item: &CollabAgentToolCallItem, state: &mut CodexSessionState) {
    if let (Some(children), Some(prompt)) = (&item.receiver_thread_ids, &item.prompt) {
        for child_id in children {
            state.spawn_prompts.insert(child_id.clone(), prompt.clone());
        }
    }
}

pub(crate) fn emit_collab_task_group_start(
    item: &CollabAgentToolCallItem,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    state.open_collab_cards.insert(item.id.clone());
    let children = item.receiver_thread_ids.clone().unwrap_or_default();
    // Register the spawned thread(s) so subsequent child items get tagged.
    for child_id in &children {
        state
            .collab_child_threads
            .insert(child_id.clone(), item.id.clone());
    }
    // One lookup covers both the title/description derivation below and each
    // child's rollout_path for the live tail — the brief calls out not to
    // look this up twice.
    let meta_by_thread = lookup_agent_metadata(&children);
    let child_id = children.first();
    // Same identity mapping as history.rs — subagent_type is the nickname,
    // description is the spawn prompt (more informative than the bare role).
    let meta = child_id.and_then(|c| meta_by_thread.get(c));
    let subagent_type = agent_title(meta)
        .or_else(|| describe_agent(meta))
        .unwrap_or_else(|| "Sub-agent".to_string());
    let prompt = child_id
        .and_then(|c| state.spawn_prompts.get(c).cloned())
        .or_else(|| item.prompt.clone())
        .unwrap_or_default();
    let description = describe_agent(meta).unwrap_or_else(|| {
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
    spawn_child_tails(&children, &item.id, &meta_by_thread, sink, state);
}

/// Starts a live rollout tail for each child thread with a known `rollout_path`,
/// skipping any child already being tailed (double-tail guard on re-entrant
/// `wait` items) and any child whose metadata has no rollout_path yet.
fn spawn_child_tails(
    children: &[String],
    parent_tool_use_id: &str,
    meta_by_thread: &HashMap<String, AgentMetadata>,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    for child_id in children {
        if state.child_tails.contains_key(child_id) {
            continue;
        }
        let Some(rollout_path) = meta_by_thread
            .get(child_id)
            .and_then(|m| m.rollout_path.clone())
        else {
            tracing::debug!(
                module = "codex:events",
                child_id,
                "codex: no rollout_path for sub-agent, skipping live tail"
            );
            continue;
        };
        let cancel = CancellationToken::new();
        let handle = spawn_child_tail(
            child_id.clone(),
            rollout_path,
            sink.clone(),
            parent_tool_use_id.to_string(),
            cancel.clone(),
            None,
        );
        state.child_tails.insert(child_id.clone(), (handle, cancel));
    }
}
