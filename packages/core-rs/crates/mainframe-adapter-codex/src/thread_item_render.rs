//! Renders a completed `ThreadItem` into `SessionSink` calls. Moved out of
//! `event_mapper.rs`'s `handle_item_completed` (was ~117 lines, over the
//! 50-line ceiling) — the notification-dispatch shell stays in event_mapper.rs.

use std::collections::HashMap;
use std::sync::Arc;

use mainframe_adapter_api::SessionSink;
use mainframe_types::chat::{TodoItem, TodoStatus};

use crate::collab_card;
use crate::event_mapper::CodexSessionState;
use crate::history::{
    bash_input, file_change_input, is_exec_error, mcp_result_content, parse_unified_diff,
    reasoning_text, text_block, thinking_block, tool_result_block, tool_use_block, vendor_metadata,
};
use crate::image_generation_render::handle_image_generation;
use crate::item_types::{
    CommandExecutionItem, DynamicToolCallItem, FileChangeItem, McpToolCallItem, ReasoningItem,
    ThreadItem, TodoListItem,
};
use crate::web_search_render::render_web_search;

/// Dispatches one parsed `ThreadItem` from `item/completed` to the sink. `sink` is
/// already wrapped with `ParentIdSink` by the caller when the item belongs to a
/// spawned sub-agent's thread; `thread_id` is that item's own (unwrapped) Codex
/// thread id, used to key the CollabAgent card engine.
pub(crate) fn render_completed_item(
    item: ThreadItem,
    thread_id: Option<&str>,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    match item {
        ThreadItem::AgentMessage(m) => render_agent_message(&m.id, &m.text, thread_id, sink, state),
        ThreadItem::Reasoning(r) => render_reasoning(&r, sink),
        ThreadItem::CommandExecution(c) => render_command_execution(&c, sink),
        ThreadItem::FileChange(f) => render_file_change(&f, sink),
        ThreadItem::ImageGeneration(img) => handle_image_generation(img, sink),
        ThreadItem::CollabAgentToolCall(item) => {
            collab_card::on_collab_tool_call(&item, collab_card::Phase::Completed, sink, state);
        }
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
        ThreadItem::SubAgentActivity(a) => collab_card::on_sub_agent_activity(&a, sink, state),
        ThreadItem::WebSearch(w) => render_web_search(&w, sink),
        ThreadItem::UserMessage(_) => {
            tracing::debug!(module = "codex:events", "codex: unhandled item type");
        }
    }
}

/// A child's own `agentMessage` also feeds the card engine, so its text becomes
/// the card's closing content if nothing else resolves the card first (spec
/// decision 5).
fn render_agent_message(
    id: &str,
    text: &str,
    thread_id: Option<&str>,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    sink.on_message(vec![text_block(text)], vendor_metadata(id));
    if let Some(tid) = thread_id {
        collab_card::record_child_message(tid, text, state);
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
    sink.on_message(
        vec![tool_use_block(&d.id, &name, input)],
        vendor_metadata(&d.id),
    );
}

fn render_reasoning(r: &ReasoningItem, sink: &Arc<dyn SessionSink>) {
    sink.on_message(
        vec![thinking_block(&reasoning_text(&r.summary, &r.content))],
        vendor_metadata(&r.id),
    );
}

fn render_command_execution(c: &CommandExecutionItem, sink: &Arc<dyn SessionSink>) {
    sink.on_message(
        vec![tool_use_block(&c.id, "Bash", bash_input(&c.command))],
        vendor_metadata(&c.id),
    );
    sink.on_tool_result(
        vec![tool_result_block(
            &c.id,
            &c.aggregated_output,
            is_exec_error(c.exit_code),
            None,
        )],
        Some(format!("{}:result", c.id)),
    );
}

fn render_file_change(f: &FileChangeItem, sink: &Arc<dyn SessionSink>) {
    let is_completed = f.status != "inProgress";
    let is_error = f.status == "failed" || f.status == "declined";
    for (index, change) in f.changes.iter().enumerate() {
        let tool_id = format!("{}:{}", f.id, index);
        let is_add = matches!(change.kind, crate::item_types::PatchChangeKind::Add);
        let tool_name = if is_add { "Write" } else { "Edit" };
        let input = file_change_input(is_add, &change.path, &change.diff, &change.kind);
        sink.on_message(
            vec![tool_use_block(&tool_id, tool_name, input)],
            vendor_metadata(&tool_id),
        );
        if is_completed {
            let sp = parse_unified_diff(&change.diff);
            let sp = if sp.is_empty() { None } else { Some(sp) };
            sink.on_tool_result(
                vec![tool_result_block(&tool_id, "OK", is_error, sp)],
                Some(format!("{tool_id}:result")),
            );
        }
    }
}

fn render_mcp_tool_call(m: &McpToolCallItem, sink: &Arc<dyn SessionSink>) {
    let server = m.server.as_deref().unwrap_or("codex");
    let tool_name = format!("mcp__{server}__{}", m.tool);
    sink.on_message(
        vec![tool_use_block(&m.id, &tool_name, m.arguments.clone())],
        vendor_metadata(&m.id),
    );
    let content = mcp_result_content(m.result.as_ref().map(|r| &r.content), m.error.as_ref());
    sink.on_tool_result(
        vec![tool_result_block(&m.id, &content, m.error.is_some(), None)],
        Some(format!("{}:result", m.id)),
    );
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
