use super::*;
pub(super) fn convert_user_entry(
    entry: &Value,
    message: &Value,
    chat_id: &str,
) -> Option<ChatMessage> {
    let raw_content = message.get("content");
    let mut content_blocks: Vec<MessageContent> = Vec::new();
    let tool_use_result = entry.get("toolUseResult");
    match raw_content {
        Some(Value::String(s)) => {
            if s.starts_with("<task-notification>") {
                return None;
            }
            content_blocks.push(text_block(s.clone()));
        }
        Some(Value::Array(arr)) => {
            content_blocks.extend(build_tool_result_blocks(message, tool_use_result));
            content_blocks.extend(extract_user_content_blocks(
                arr,
                &ExtractOpts {
                    skip_interrupted: true,
                },
            ));
        }
        _ => {}
    }
    if content_blocks.is_empty() {
        return None;
    }
    let has_tool_result = content_blocks.iter().any(|b| {
        matches!(
            b,
            MessageContent::Node(MessageContentNode::ToolResult { .. })
        )
    });
    Some(ChatMessage {
        id: id_or_nanoid(entry),
        chat_id: chat_id.to_string(),
        r#type: if has_tool_result {
            ChatMessageType::ToolResult
        } else {
            ChatMessageType::User
        },
        content: content_blocks,
        timestamp: timestamp_or_now(entry),
        metadata: meta_or_none(history_meta()),
    })
}
pub(super) fn convert_queued_command_entry(entry: &Value, chat_id: &str) -> Option<ChatMessage> {
    let attachment = entry.get("attachment")?;
    let atype = attachment.get("type").and_then(Value::as_str);
    let mode = attachment.get("commandMode").and_then(Value::as_str);
    if atype != Some("queued_command") || mode != Some("prompt") {
        return None;
    }
    let prompt = attachment.get("prompt");
    let mut content_blocks: Vec<MessageContent> = Vec::new();
    match prompt {
        Some(Value::String(s)) => {
            if !s.trim().is_empty() {
                content_blocks.push(text_block(s.clone()));
            }
        }
        Some(Value::Array(arr)) => {
            content_blocks.extend(extract_user_content_blocks(
                arr,
                &ExtractOpts {
                    skip_interrupted: false,
                },
            ));
        }
        _ => {}
    }
    if content_blocks.is_empty() {
        return None;
    }
    let timestamp = entry
        .get("timestamp")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            attachment
                .get("timestamp")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
        })
        .map(str::to_string)
        .unwrap_or_else(now_iso8601);
    Some(ChatMessage {
        id: id_or_nanoid(entry),
        chat_id: chat_id.to_string(),
        r#type: ChatMessageType::User,
        content: content_blocks,
        timestamp,
        metadata: meta_or_none(history_meta()),
    })
}
