//! Ported from `packages/core/src/messages/session-files.ts`.

use mainframe_types::chat::{ChatMessage, MessageContent, MessageContentNode};

const FILE_TOOLS: [&str; 2] = ["Write", "Edit"];

/// Extract deduplicated file paths from Write/Edit tool_use blocks in messages.
pub fn extract_session_file_paths(messages: &[ChatMessage]) -> Vec<String> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut paths: Vec<String> = Vec::new();

    for message in messages {
        for block in &message.content {
            let MessageContent::Node(MessageContentNode::ToolUse { name, input, .. }) = block
            else {
                continue;
            };
            if !FILE_TOOLS.contains(&name.as_str()) {
                continue;
            }
            let file_path = input.get("file_path").and_then(|v| v.as_str());
            if let Some(fp) = file_path
                && !fp.is_empty()
                && !seen.contains(fp)
            {
                seen.insert(fp.to_string());
                paths.push(fp.to_string());
            }
        }
    }

    paths
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::chat::ChatMessageType;
    use serde_json::json;
    use std::collections::HashMap;

    fn tool_use(name: &str, file_path: Option<&str>) -> MessageContent {
        let mut input: HashMap<String, serde_json::Value> = HashMap::new();
        if let Some(fp) = file_path {
            input.insert("file_path".to_string(), json!(fp));
        }
        MessageContent::Node(MessageContentNode::ToolUse {
            id: "tu".to_string(),
            name: name.to_string(),
            input,
            parent_tool_use_id: None,
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
    fn dedupes_write_edit_paths_and_ignores_other_tools() {
        let messages = vec![assistant(vec![
            tool_use("Write", Some("/a.ts")),
            tool_use("Read", Some("/b.ts")),
            tool_use("Edit", Some("/a.ts")),
            tool_use("Edit", Some("/c.ts")),
        ])];
        assert_eq!(
            extract_session_file_paths(&messages),
            vec!["/a.ts".to_string(), "/c.ts".to_string()]
        );
    }
}

// PORT STATUS: src/messages/session-files.ts (22 lines)
// confidence: high
// todos: 0
// notes: FILE_TOOLS = {Write, Edit}; `block.input?.file_path` truthy check →
// as_str + non-empty. Neutral ChatMessage input; no Claude JSONL shapes. No TS
// __tests__ file — sanity test covers dedupe + tool filtering.
