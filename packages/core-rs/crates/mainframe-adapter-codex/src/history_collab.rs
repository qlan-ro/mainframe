//! Todo #247 task 20 — reload-path rendering for a sub-agent card, rewritten
//! around the child thread id (`history_convert.rs`'s `open_card`/`resolve_card`
//! own *when* a card opens or closes; this module only renders). Mirrors what
//! the live path's `collab_card::open_card` / `collab_resolve::resolve_card`
//! emit incrementally, but in one pass over the already-loaded child items.

use std::collections::HashMap;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};

use crate::collab_identity::{card_task_line, card_title};
use crate::history::{collab_agent_tool_use, make_message, tool_result_block, with_parent};
use crate::history_convert::convert_thread_items;
use crate::item_types::ThreadItem;
use crate::thread_registry::AgentMetadata;

/// Opens a card: emits its `CollabAgent` tool_use, then nests the child's own
/// converted transcript under it (skipping the child's user-prompt echo,
/// splitting `tool_result` blocks into their own `ChatMessage`s — same shape
/// the legacy `emit_collab_agent` produced).
#[allow(clippy::too_many_arguments)]
pub(crate) fn emit_sub_agent_card(
    messages: &mut Vec<ChatMessage>,
    chat_id: &str,
    card_id: &str,
    child_thread_id: &str,
    agent_path: Option<&str>,
    prompt: Option<&str>,
    child_items_by_thread: &HashMap<String, Vec<ThreadItem>>,
    agent_meta_by_thread: &HashMap<String, AgentMetadata>,
) {
    let title = card_title(agent_meta_by_thread.get(child_thread_id), agent_path);
    let prompt_text = prompt.unwrap_or_default().to_string();
    let description = card_task_line(Some(prompt_text.as_str()).filter(|p| !p.is_empty()), &title);

    let mut content: Vec<MessageContent> = vec![collab_agent_tool_use(
        card_id,
        &prompt_text,
        &description,
        &title,
    )];
    let mut child_tool_results: Vec<MessageContent> = Vec::new();

    if let Some(child_items) = child_items_by_thread.get(child_thread_id)
        && !child_items.is_empty()
    {
        let empty = HashMap::new();
        let child_messages =
            convert_thread_items(child_items, chat_id, child_items_by_thread, &empty);
        for m in &child_messages {
            if m.r#type == ChatMessageType::User {
                continue;
            }
            for block in &m.content {
                if matches!(
                    block,
                    MessageContent::Node(MessageContentNode::ToolResult { .. })
                ) {
                    child_tool_results.push(with_parent(block.clone(), card_id));
                } else {
                    content.push(with_parent(block.clone(), card_id));
                }
            }
        }
    }

    messages.push(make_message(
        card_id,
        chat_id,
        ChatMessageType::Assistant,
        content,
    ));
    for (index, r) in child_tool_results.into_iter().enumerate() {
        messages.push(make_message(
            &format!("{card_id}:child:{index}:result"),
            chat_id,
            ChatMessageType::ToolResult,
            vec![r],
        ));
    }
}

/// Closes a card with its `tool_result`.
pub(crate) fn emit_sub_agent_result(
    messages: &mut Vec<ChatMessage>,
    chat_id: &str,
    card_id: &str,
    content: &str,
    is_error: bool,
) {
    messages.push(make_message(
        &format!("{card_id}:result"),
        chat_id,
        ChatMessageType::ToolResult,
        vec![tool_result_block(card_id, content, is_error, None)],
    ));
}

/// The child thread's last non-empty `agentMessage` text — the reload-path
/// counterpart to the live path's `last_message` (spec decision 5), used when
/// `agentsStates` carries no message for this child.
pub(crate) fn child_last_message(items: Option<&Vec<ThreadItem>>) -> Option<String> {
    items?.iter().rev().find_map(|item| match item {
        ThreadItem::AgentMessage(m) if !m.text.is_empty() => Some(m.text.clone()),
        _ => None,
    })
}
