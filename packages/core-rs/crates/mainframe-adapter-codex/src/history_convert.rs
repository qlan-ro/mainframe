//! Moved out of `history.rs` (task 2, todo #247) to keep that file under the
//! 300-line ceiling. `convert_thread_items` (the chat-reload path) and its
//! `user_message_text` helper, unchanged.

use std::collections::HashMap;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};

use crate::history::{
    bash_input, file_change_input, is_exec_error, make_message, mcp_result_content, reasoning_text,
    text_block, thinking_block, tool_result_block, tool_use_block,
};
use crate::history_collab_resolve::{
    CardMap, CollabCtx, handle_collab_tool_call, handle_sub_agent_activity, resolve_open_cards,
};
use crate::item_types::{PatchChangeKind, ThreadItem};
use crate::thread_registry::AgentMetadata;
use crate::unified_diff::parse_unified_diff;

pub fn convert_thread_items(
    items: &[ThreadItem],
    chat_id: &str,
    child_items_by_thread: &HashMap<String, Vec<ThreadItem>>,
    agent_meta_by_thread: &HashMap<String, AgentMetadata>,
) -> Vec<ChatMessage> {
    let mut messages: Vec<ChatMessage> = Vec::new();
    // Stash spawnAgent prompts (keyed by child thread id) so the matching `wait`
    // item can use them as the TaskGroup card's description.
    let mut spawn_prompts: HashMap<String, String> = HashMap::new();
    let mut cards: CardMap = HashMap::new();
    let ctx = CollabCtx {
        chat_id,
        child_items_by_thread,
        agent_meta_by_thread,
    };

    for item in items {
        match item {
            ThreadItem::AgentMessage(m) => {
                messages.push(make_message(
                    &m.id,
                    chat_id,
                    ChatMessageType::Assistant,
                    vec![text_block(&m.text)],
                ));
            }
            ThreadItem::Reasoning(r) => {
                messages.push(make_message(
                    &r.id,
                    chat_id,
                    ChatMessageType::Assistant,
                    vec![thinking_block(&reasoning_text(&r.summary, &r.content))],
                ));
            }
            ThreadItem::CommandExecution(c) => {
                messages.push(make_message(
                    &c.id,
                    chat_id,
                    ChatMessageType::Assistant,
                    vec![tool_use_block(&c.id, "Bash", bash_input(&c.command))],
                ));
                messages.push(make_message(
                    &format!("{}:result", c.id),
                    chat_id,
                    ChatMessageType::ToolResult,
                    vec![tool_result_block(
                        &c.id,
                        &c.aggregated_output,
                        is_exec_error(c.exit_code),
                        None,
                    )],
                ));
            }
            ThreadItem::FileChange(f) => {
                let is_error = f.status == "failed" || f.status == "declined";
                for (index, change) in f.changes.iter().enumerate() {
                    let tool_id = format!("{}:{}", f.id, index);
                    let is_add = matches!(change.kind, PatchChangeKind::Add);
                    let tool_name = if is_add { "Write" } else { "Edit" };
                    let structured_patch = parse_unified_diff(&change.diff);
                    let input = file_change_input(is_add, &change.path, &change.diff, &change.kind);
                    messages.push(make_message(
                        &tool_id,
                        chat_id,
                        ChatMessageType::Assistant,
                        vec![tool_use_block(&tool_id, tool_name, input)],
                    ));
                    let sp = if structured_patch.is_empty() {
                        None
                    } else {
                        Some(structured_patch)
                    };
                    messages.push(make_message(
                        &format!("{tool_id}:result"),
                        chat_id,
                        ChatMessageType::ToolResult,
                        vec![tool_result_block(&tool_id, "OK", is_error, sp)],
                    ));
                }
            }
            ThreadItem::McpToolCall(m) => {
                let server = m.server.as_deref().unwrap_or("codex");
                let tool_name = format!("mcp__{server}__{}", m.tool);
                messages.push(make_message(
                    &m.id,
                    chat_id,
                    ChatMessageType::Assistant,
                    vec![tool_use_block(&m.id, &tool_name, m.arguments.clone())],
                ));
                let content =
                    mcp_result_content(m.result.as_ref().map(|r| &r.content), m.error.as_ref());
                messages.push(make_message(
                    &format!("{}:result", m.id),
                    chat_id,
                    ChatMessageType::ToolResult,
                    vec![tool_result_block(&m.id, &content, m.error.is_some(), None)],
                ));
            }
            ThreadItem::UserMessage(u) => {
                let text = user_message_text(u);
                if text.is_empty() {
                    continue;
                }
                messages.push(make_message(
                    &u.id,
                    chat_id,
                    ChatMessageType::User,
                    vec![text_block(&text)],
                ));
            }
            ThreadItem::CollabAgentToolCall(item) => {
                handle_collab_tool_call(item, &mut messages, &mut spawn_prompts, &mut cards, &ctx);
            }
            ThreadItem::SubAgentActivity(a) => {
                handle_sub_agent_activity(a, &mut messages, &spawn_prompts, &mut cards, &ctx);
            }
            ThreadItem::ContextCompaction(c) => {
                // Same "Context compacted" pill Claude's compact_boundary produces.
                messages.push(make_message(
                    &c.id,
                    chat_id,
                    ChatMessageType::System,
                    vec![MessageContent::Node(MessageContentNode::Compaction {
                        parent_tool_use_id: None,
                    })],
                ));
            }
            ThreadItem::ImageGeneration(img) => {
                if let Some(m) =
                    crate::image_generation_history::image_generation_message(img, chat_id)
                {
                    messages.push(m);
                }
            }
            ThreadItem::WebSearch(w) => {
                messages.extend(crate::web_search_history::web_search_messages(w, chat_id));
            }
            // todoList — skip for now
            _ => {}
        }
    }

    // Backstop: a card whose child never signals completion via `wait` or a
    // `subAgentActivity` interruption still closes, mirroring the live path's
    // parent-turn-end resolution.
    resolve_open_cards(&mut messages, &mut cards, &ctx);

    messages
}

fn user_message_text(u: &crate::item_types::UserMessageItem) -> String {
    u.content
        .as_ref()
        .and_then(|blocks| {
            blocks
                .iter()
                .find(|b| b.text.as_deref().map(|t| !t.is_empty()).unwrap_or(false))
                .and_then(|b| b.text.clone())
        })
        .or_else(|| u.text.clone())
        .unwrap_or_default()
}
