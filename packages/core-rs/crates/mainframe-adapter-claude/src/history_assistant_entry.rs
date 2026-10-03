use super::*;
pub(super) fn convert_assistant_entry(
    entry: &Value,
    message: &Value,
    chat_id: &str,
    seen_api_message_ids: &mut std::collections::HashSet<String>,
) -> Option<ChatMessage> {
    let (content_blocks, has_representable_content) = assistant_content(message)?;
    let id = match message
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        Some(mid) if has_representable_content && seen_api_message_ids.insert(mid.to_string()) => {
            mid.to_string()
        }
        _ => id_or_nanoid(entry),
    };

    let mut meta = history_meta();
    if js_truthy(message.get("model"))
        && let Some(model) = message.get("model")
    {
        meta.insert("model".to_string(), model.clone());
    }
    if js_truthy(message.get("usage"))
        && let Some(usage) = message.get("usage")
        && let Ok(usage) = serde_json::from_value::<MessageUsage>(usage.clone())
        && let Ok(v) = serde_json::to_value(usage)
    {
        meta.insert("usage".to_string(), v);
    }

    Some(ChatMessage {
        id,
        chat_id: chat_id.to_string(),
        r#type: ChatMessageType::Assistant,
        content: content_blocks,
        timestamp: timestamp_or_now(entry),
        metadata: meta_or_none(meta),
    })
}

fn assistant_content(message: &Value) -> Option<(Vec<MessageContent>, bool)> {
    let mut content_blocks: Vec<MessageContent> = Vec::new();

    if let Some(Value::Array(arr)) = message.get("content") {
        for block in arr {
            append_assistant_block(block, &mut content_blocks);
        }
    }
    let has_representable_content = !content_blocks.is_empty();

    if content_blocks.is_empty() {
        let raw_blocks = message
            .get("content")
            .and_then(Value::as_array)
            .filter(|arr| !arr.is_empty())
            .filter(|arr| {
                arr.iter()
                    .all(|b| b.get("type").and_then(Value::as_str) == Some("thinking"))
            })?;
        for block in raw_blocks {
            let thinking = block
                .get("thinking")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            content_blocks.push(MessageContent::Leaf(LeafContent::Thinking {
                thinking,
                parent_tool_use_id: None,
            }));
        }
    }
    Some((content_blocks, has_representable_content))
}

fn append_assistant_block(block: &Value, content_blocks: &mut Vec<MessageContent>) {
    match block.get("type").and_then(Value::as_str) {
        Some("text") => content_blocks.push(text_block(
            block
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        )),
        Some("thinking") => {
            let thinking = block
                .get("thinking")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if !thinking.trim().is_empty() {
                content_blocks.push(MessageContent::Leaf(LeafContent::Thinking {
                    thinking,
                    parent_tool_use_id: None,
                }))
            }
        }
        Some("tool_use") => {
            content_blocks.push(MessageContent::Node(MessageContentNode::ToolUse {
                timing: None,
                command_execution: None,
                id: block
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                name: block
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                input: value_object_to_map(block.get("input")),
                parent_tool_use_id: None,
            }))
        }
        _ => {}
    }
}
