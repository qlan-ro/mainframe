//! Ported from `packages/core/src/plugins/builtin/claude/history-subagents.ts`.
//!
//! Subagent inlining for history replay: collect a subagent's assistant blocks
//! and tool_results (from `agent_progress` events and subagent JSONL files),
//! then inject them under the parent thread's Agent/Task tool_use.

use std::collections::HashMap;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use serde_json::Value;

use crate::history_tool_result::{build_tool_result_blocks, js_truthy};

fn object_to_map(v: Option<&Value>) -> HashMap<String, Value> {
    match v.and_then(Value::as_object) {
        Some(obj) => obj
            .iter()
            .map(|(k, val)| (k.clone(), val.clone()))
            .collect(),
        None => HashMap::new(),
    }
}

/// Flatten a subagent assistant message's content (tool_use / text / thinking)
/// onto the accumulated child-block list keyed by parentId.
pub fn append_assistant_blocks(
    parent_id: &str,
    content: &[Value],
    agent_tools: &mut HashMap<String, Vec<MessageContent>>,
) {
    let mut existing = agent_tools.get(parent_id).cloned().unwrap_or_default();
    for block in content {
        match block.get("type").and_then(Value::as_str) {
            Some("tool_use") => existing.push(MessageContent::Node(MessageContentNode::ToolUse {
                id: block
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| nanoid::nanoid!()),
                name: block
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                input: object_to_map(block.get("input")),
                parent_tool_use_id: Some(parent_id.to_string()),
            })),
            Some("text") => {
                let text = block.get("text").and_then(Value::as_str).unwrap_or("");
                if !text.trim().is_empty() {
                    existing.push(MessageContent::Leaf(LeafContent::Text {
                        text: text.to_string(),
                        parent_tool_use_id: Some(parent_id.to_string()),
                    }));
                }
            }
            Some("thinking") => {
                let t = block.get("thinking").and_then(Value::as_str).unwrap_or("");
                if !t.trim().is_empty() {
                    existing.push(MessageContent::Leaf(LeafContent::Thinking {
                        thinking: t.to_string(),
                        parent_tool_use_id: Some(parent_id.to_string()),
                    }));
                }
            }
            _ => {}
        }
    }
    if !existing.is_empty() {
        agent_tools.insert(parent_id.to_string(), existing);
    }
}

pub fn collect_agent_progress_tools(
    entry: &Value,
    agent_tools: &mut HashMap<String, Vec<MessageContent>>,
) {
    let parent_id = match entry
        .get("parentToolUseID")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        Some(p) => p.to_string(),
        None => return,
    };
    let inner = entry
        .get("data")
        .and_then(|d| d.get("message"))
        .and_then(|m| m.get("message"));
    let inner = match inner {
        Some(i) if i.get("role").and_then(Value::as_str) == Some("assistant") => i,
        _ => return,
    };
    let content = match inner.get("content").and_then(Value::as_array) {
        Some(c) => c,
        None => return,
    };
    append_assistant_blocks(&parent_id, content, agent_tools);
}

/// Extract tool_result blocks from subagent JSONL user entries.
pub fn collect_subagent_tool_results(entry: &Value, results: &mut HashMap<String, MessageContent>) {
    if entry.get("type").and_then(Value::as_str) != Some("user") {
        return;
    }
    let message = match entry.get("message") {
        Some(m) if js_truthy(Some(m)) => m,
        _ => return,
    };
    if !matches!(message.get("content"), Some(Value::Array(_))) {
        return;
    }
    let tool_use_result = entry.get("toolUseResult");
    let blocks = build_tool_result_blocks(message, tool_use_result);
    for block in blocks {
        if let MessageContent::Node(MessageContentNode::ToolResult { tool_use_id, .. }) = &block {
            results.insert(tool_use_id.clone(), block);
        }
    }
}

/// Capture the agentId → parent tool_use_id mapping from a parent-JSONL user
/// entry whose tool_result corresponds to a Task/Agent dispatch.
pub fn capture_agent_id_mapping(entry: &Value, map: &mut HashMap<String, String>) {
    if entry.get("type").and_then(Value::as_str) != Some("user") {
        return;
    }
    let tur = entry
        .get("toolUseResult")
        .or_else(|| entry.get("tool_use_result"));
    let agent_id = match tur.and_then(|t| t.get("agentId")).and_then(Value::as_str) {
        Some(a) => a.to_string(),
        None => return,
    };
    let content = match entry
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    {
        Some(c) => c,
        None => return,
    };
    for block in content {
        if block.get("type").and_then(Value::as_str) == Some("tool_result")
            && let Some(tuid) = block.get("tool_use_id").and_then(Value::as_str)
        {
            map.insert(agent_id, tuid.to_string());
            return;
        }
    }
}

/// Collect assistant text/thinking/tool_use blocks from subagent JSONL assistant entries.
pub fn collect_subagent_assistant_blocks(
    entry: &Value,
    agent_tools: &mut HashMap<String, Vec<MessageContent>>,
    agent_id_map: Option<&HashMap<String, String>>,
) {
    let mut parent_id = entry
        .get("parentToolUseID")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    if parent_id.is_none()
        && let Some(map) = agent_id_map
        && let Some(agent_id) = entry
            .get("agentId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
    {
        parent_id = map.get(agent_id).cloned();
    }
    let parent_id = match parent_id {
        Some(p) => p,
        None => return,
    };
    if entry.get("type").and_then(Value::as_str) != Some("assistant") {
        return;
    }
    let content = match entry
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    {
        Some(c) => c,
        None => return,
    };
    append_assistant_blocks(&parent_id, content, agent_tools);
}

/// Inject subagent tool_result blocks after their matching tool_use in assistant messages.
pub fn attach_subagent_tool_results(
    messages: &mut [ChatMessage],
    results: &HashMap<String, MessageContent>,
) {
    for msg in messages.iter_mut() {
        if msg.r#type != ChatMessageType::Assistant {
            continue;
        }
        let mut new_content: Vec<MessageContent> = Vec::new();
        for block in msg.content.drain(..) {
            let tool_use_ref = match &block {
                MessageContent::Node(MessageContentNode::ToolUse {
                    id,
                    parent_tool_use_id,
                    ..
                }) => Some((id.clone(), parent_tool_use_id.clone())),
                _ => None,
            };
            new_content.push(block);
            if let Some((id, parent)) = tool_use_ref
                && let Some(MessageContent::Node(MessageContentNode::ToolResult {
                    tool_use_id,
                    content,
                    is_error,
                    structured_patch,
                    original_file,
                    modified_file,
                    ..
                })) = results.get(&id)
            {
                new_content.push(MessageContent::Node(MessageContentNode::ToolResult {
                    tool_use_id: tool_use_id.clone(),
                    content: content.clone(),
                    is_error: *is_error,
                    structured_patch: structured_patch.clone(),
                    original_file: original_file.clone(),
                    modified_file: modified_file.clone(),
                    parent_tool_use_id: parent,
                }));
            }
        }
        msg.content = new_content;
    }
}

pub fn inject_agent_children(
    messages: &mut [ChatMessage],
    agent_tools: &HashMap<String, Vec<MessageContent>>,
) {
    for msg in messages.iter_mut() {
        if msg.r#type != ChatMessageType::Assistant {
            continue;
        }
        let mut new_content: Vec<MessageContent> = Vec::new();
        for block in msg.content.drain(..) {
            let children_key = match &block {
                MessageContent::Node(MessageContentNode::ToolUse { id, name, .. })
                    if name == "Agent" || name == "Task" =>
                {
                    Some(id.clone())
                }
                _ => None,
            };
            new_content.push(block);
            if let Some(id) = children_key
                && let Some(children) = agent_tools.get(&id)
            {
                new_content.extend(children.iter().cloned());
            }
        }
        msg.content = new_content;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tool_use(id: &str, name: &str, parent: Option<&str>) -> MessageContent {
        MessageContent::Node(MessageContentNode::ToolUse {
            id: id.to_string(),
            name: name.to_string(),
            input: HashMap::new(),
            parent_tool_use_id: parent.map(str::to_string),
        })
    }

    fn assistant(content: Vec<MessageContent>) -> ChatMessage {
        ChatMessage {
            id: "m".to_string(),
            chat_id: "c".to_string(),
            r#type: ChatMessageType::Assistant,
            content,
            timestamp: "t".to_string(),
            metadata: None,
        }
    }

    #[test]
    fn append_assistant_blocks_tags_parent_and_skips_empty() {
        let mut tools: HashMap<String, Vec<MessageContent>> = HashMap::new();
        let content = vec![
            json!({ "type": "text", "text": "   " }),
            json!({ "type": "text", "text": "hi" }),
            json!({ "type": "tool_use", "id": "tu_1", "name": "Grep", "input": {} }),
        ];
        append_assistant_blocks("parent-1", &content, &mut tools);
        let blocks = tools.get("parent-1").unwrap();
        assert_eq!(blocks.len(), 2); // whitespace-only text dropped
        assert!(matches!(
            &blocks[0],
            MessageContent::Leaf(LeafContent::Text { parent_tool_use_id: Some(p), .. }) if p == "parent-1"
        ));
    }

    #[test]
    fn inject_agent_children_places_children_after_agent_tool_use() {
        let mut tools: HashMap<String, Vec<MessageContent>> = HashMap::new();
        tools.insert(
            "agent-tu".to_string(),
            vec![tool_use("child", "Bash", Some("agent-tu"))],
        );
        let mut messages = vec![assistant(vec![tool_use("agent-tu", "Task", None)])];
        inject_agent_children(&mut messages, &tools);
        assert_eq!(messages[0].content.len(), 2);
        assert!(matches!(
            &messages[0].content[1],
            MessageContent::Node(MessageContentNode::ToolUse { id, .. }) if id == "child"
        ));
    }

    #[test]
    fn attach_subagent_tool_results_appends_after_tool_use_with_parent() {
        let mut results: HashMap<String, MessageContent> = HashMap::new();
        results.insert(
            "child".to_string(),
            MessageContent::Node(MessageContentNode::ToolResult {
                tool_use_id: "child".to_string(),
                content: "R".to_string(),
                is_error: false,
                structured_patch: None,
                original_file: None,
                modified_file: None,
                parent_tool_use_id: None,
            }),
        );
        let mut messages = vec![assistant(vec![tool_use("child", "Bash", Some("agent-tu"))])];
        attach_subagent_tool_results(&mut messages, &results);
        assert_eq!(messages[0].content.len(), 2);
        match &messages[0].content[1] {
            MessageContent::Node(MessageContentNode::ToolResult {
                tool_use_id,
                parent_tool_use_id,
                ..
            }) => {
                assert_eq!(tool_use_id, "child");
                // parentToolUseId inherited from the tool_use block.
                assert_eq!(parent_tool_use_id.as_deref(), Some("agent-tu"));
            }
            _ => panic!("expected tool_result"),
        }
    }

    #[test]
    fn capture_agent_id_mapping_links_agent_to_tool_use() {
        let mut map: HashMap<String, String> = HashMap::new();
        let entry = json!({
            "type": "user",
            "toolUseResult": { "agentId": "agent-9" },
            "message": { "content": [{ "type": "tool_result", "tool_use_id": "tu_parent" }] }
        });
        capture_agent_id_mapping(&entry, &mut map);
        assert_eq!(map.get("agent-9").map(String::as_str), Some("tu_parent"));
    }
}

// PORT STATUS: src/plugins/builtin/claude/history-subagents.ts (147 lines)
// confidence: high
// todos: 0
// notes: JSONL entries navigated as serde_json::Value. appendAssistantBlocks's
// get-or-new + set-back is a clone-modify-reinsert (observationally identical to
// the TS in-place mutate + redundant set). `{...tr, parentToolUseId}` spread is a
// field-by-field ToolResult rebuild with parent_tool_use_id overridden. No TS
// __tests__ file for this module — added sanity tests for the core paths.
