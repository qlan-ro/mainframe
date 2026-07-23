//! Renders a completed `ThreadItem` into `SessionSink` calls. Moved out of
//! `event_mapper.rs`'s `handle_item_completed` (was ~117 lines, over the
//! 50-line ceiling) — the notification-dispatch shell stays in event_mapper.rs.

use std::sync::Arc;

use mainframe_adapter_api::SessionSink;
use mainframe_types::chat::{MessageContent, TodoItem, TodoStatus};

use crate::event_mapper::CodexSessionState;
use crate::history::{
    bash_input, collab_agent_tool_use, file_change_input, image_block, is_exec_error,
    mcp_result_content, parse_unified_diff, reasoning_text, text_block, thinking_block,
    tool_result_block, tool_use_block,
};
use crate::item_types::{
    CollabAgentToolCallItem, CommandExecutionItem, FileChangeItem, ImageGenerationItem,
    McpToolCallItem, ReasoningItem, ThreadItem, TodoListItem,
};
use crate::thread_registry::{agent_title, describe_agent, lookup_agent_metadata};

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
        _ => {
            tracing::debug!(module = "codex:events", "codex: unhandled item type");
        }
    }
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

fn handle_image_generation(img: ImageGenerationItem, sink: &Arc<dyn SessionSink>) {
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
