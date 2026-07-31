//! Moved out of `history.rs` (task 2, todo #247) to keep that file under the
//! 300-line ceiling. `emit_collab_agent`, unchanged.

use std::collections::HashMap;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};

use crate::history::{collab_agent_tool_use, make_message, tool_result_block, with_parent};
use crate::history_convert::convert_thread_items;
use crate::item_types::{CollabAgentToolCallItem, ThreadItem};
use crate::thread_registry::{AgentMetadata, agent_title, describe_agent};

pub(crate) fn emit_collab_agent(
    messages: &mut Vec<ChatMessage>,
    chat_id: &str,
    item: &CollabAgentToolCallItem,
    spawn_prompts: &mut HashMap<String, String>,
    child_items_by_thread: &HashMap<String, Vec<ThreadItem>>,
    agent_meta_by_thread: &HashMap<String, AgentMetadata>,
) {
    let is_error = item.status == "failed" || item.status == "interrupted";
    let child_id = item
        .receiver_thread_ids
        .as_ref()
        .and_then(|ids| ids.first());
    let meta = child_id.and_then(|c| agent_meta_by_thread.get(c));
    let subagent_type = agent_title(meta)
        .or_else(|| describe_agent(meta))
        .unwrap_or_else(|| "Sub-agent".to_string());
    let prompt = child_id
        .and_then(|c| spawn_prompts.get(c).cloned())
        .or_else(|| item.prompt.clone())
        .unwrap_or_default();
    let description = describe_agent(meta).unwrap_or_else(|| {
        if prompt.is_empty() {
            subagent_type.clone()
        } else {
            prompt.clone()
        }
    });
    let sub_agent_message = child_id
        .and_then(|c| item.agents_states.as_ref().and_then(|s| s.get(c)))
        .and_then(|s| s.message.clone());

    let mut content: Vec<MessageContent> = vec![collab_agent_tool_use(
        &item.id,
        &prompt,
        &description,
        &subagent_type,
    )];
    let mut child_tool_results: Vec<MessageContent> = Vec::new();

    if let Some(cid) = child_id
        && let Some(child_items) = child_items_by_thread.get(cid)
        && !child_items.is_empty()
    {
        let empty = HashMap::new();
        let child_messages =
            convert_thread_items(child_items, chat_id, child_items_by_thread, &empty);
        for m in &child_messages {
            // Skip the child thread's user-prompt echo.
            if m.r#type == ChatMessageType::User {
                continue;
            }
            for block in &m.content {
                if matches!(
                    block,
                    MessageContent::Node(
                        mainframe_types::chat::MessageContentNode::ToolResult { .. }
                    )
                ) {
                    child_tool_results.push(with_parent(block.clone(), &item.id));
                } else {
                    content.push(with_parent(block.clone(), &item.id));
                }
            }
        }
    }

    messages.push(make_message(
        &item.id,
        chat_id,
        ChatMessageType::Assistant,
        content,
    ));
    for (index, r) in child_tool_results.into_iter().enumerate() {
        messages.push(make_message(
            &format!("{}:child:{index}:result", item.id),
            chat_id,
            ChatMessageType::ToolResult,
            vec![r],
        ));
    }
    // Close the card with the CollabAgent's own tool_result (sub-agent's final message).
    let final_content = sub_agent_message.unwrap_or_else(|| "Sub-agent completed".to_string());
    messages.push(make_message(
        &format!("{}:result", item.id),
        chat_id,
        ChatMessageType::ToolResult,
        vec![tool_result_block(&item.id, &final_content, is_error, None)],
    ));
    if let Some(cid) = child_id {
        spawn_prompts.remove(cid);
    }
}
