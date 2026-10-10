use std::collections::HashMap;
use std::path::Path;

use mainframe_runtime::time::now_iso8601;
use mainframe_types::adapter::MessageUsage;
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use serde_json::Value;

use crate::history_tool_result::{build_tool_result_blocks, js_truthy};

pub(crate) fn synthesize_unknown_command_from_user_entry(
    entry: &Value,
    chat_id: &str,
) -> Option<Vec<ChatMessage>> {
    let content = entry.get("message").and_then(|m| m.get("content"))?;
    let content = content.as_str()?; // typeof content !== 'string' → null
    let name = match_unknown_command(content.trim())?;
    let cmd = format!("/{name}");
    let uuid = uuid_or_nanoid_nullish(entry);
    let timestamp = timestamp_or_now_nullish(entry);
    Some(vec![
        ChatMessage {
            id: format!("unknown-cmd-user-{uuid}"),
            chat_id: chat_id.to_string(),
            r#type: ChatMessageType::User,
            content: vec![text_block(cmd)],
            timestamp: timestamp.clone(),
            metadata: None,
        },
        ChatMessage {
            id: format!("unknown-cmd-err-{uuid}"),
            chat_id: chat_id.to_string(),
            r#type: ChatMessageType::System,
            content: vec![text_block(content.trim().to_string())],
            timestamp,
            metadata: None,
        },
    ])
}
fn match_unknown_command(t: &str) -> Option<String> {
    let rest = t
        .strip_prefix("Unknown command:")
        .or_else(|| t.strip_prefix("Unknown skill:"))?;
    let ws: usize = rest.chars().take_while(|c| c.is_whitespace()).count();
    if ws == 0 {
        return None;
    }
    let ws_bytes: usize = rest.chars().take(ws).map(char::len_utf8).sum();
    let mut after = &rest[ws_bytes..];
    if let Some(s) = after.strip_prefix('/') {
        after = s;
    }
    let name: String = after.chars().take_while(|c| !c.is_whitespace()).collect();
    if name.is_empty() { None } else { Some(name) }
}

pub(crate) fn synthesize_skill_loaded_from_user_entry(
    entry: &Value,
    chat_id: &str,
) -> Option<ChatMessage> {
    let content = entry.get("message").and_then(|m| m.get("content"))?;
    let arr = content.as_array()?;
    if arr.is_empty() {
        return None;
    }
    let first = &arr[0];
    if first.get("type").and_then(Value::as_str) != Some("text") {
        return None;
    }
    let text = first.get("text").and_then(Value::as_str)?;
    let base_dir = match_base_dir(text)?;
    let base_dir = base_dir.trim();
    let skill_name = Path::new(base_dir)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let skill_path = if Path::new(base_dir).extension().is_some() {
        base_dir.to_string()
    } else {
        Path::new(base_dir)
            .join("SKILL.md")
            .to_string_lossy()
            .to_string()
    };
    let skill_content = strip_base_dir_line(text).trim().to_string();
    let uuid = uuid_or_nanoid_nullish(entry);
    Some(ChatMessage {
        id: format!("skill-loaded-{uuid}"),
        chat_id: chat_id.to_string(),
        r#type: ChatMessageType::System,
        content: vec![MessageContent::Leaf(LeafContent::SkillLoaded {
            skill_name,
            path: skill_path,
            content: skill_content,
            parent_tool_use_id: None,
        })],
        timestamp: timestamp_or_now_nullish(entry),
        metadata: None,
    })
}

pub struct ExtractOpts {
    pub skip_interrupted: bool,
}
pub(crate) fn extract_user_content_blocks(
    blocks: &[Value],
    opts: &ExtractOpts,
) -> Vec<MessageContent> {
    let mut result: Vec<MessageContent> = Vec::new();
    for block in blocks {
        let btype = block.get("type").and_then(Value::as_str);
        if btype == Some("text") {
            let text = block.get("text").and_then(Value::as_str);
            if opts.skip_interrupted {
                let t = text.unwrap_or("");
                if !t.starts_with("[Request interrupted") {
                    result.push(text_block(t.to_string()));
                }
            } else if let Some(t) = text
                && !t.trim().is_empty()
            {
                result.push(text_block(t.to_string()));
            }
        } else if btype == Some("image")
            && let Some(source) = block.get("source")
            && source.get("type").and_then(Value::as_str) == Some("base64")
        {
            result.push(MessageContent::Leaf(LeafContent::Image {
                media_type: source
                    .get("media_type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                data: source
                    .get("data")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                parent_tool_use_id: None,
            }));
        }
    }
    result
}

pub fn convert_history_entry(
    entry: &Value,
    chat_id: &str,
    seen_api_message_ids: &mut std::collections::HashSet<String>,
) -> Option<ChatMessage> {
    let entry_type = entry.get("type").and_then(Value::as_str);
    if entry_type == Some("attachment") {
        return convert_queued_command_entry(entry, chat_id);
    }
    if entry_type == Some("system")
        && entry.get("subtype").and_then(Value::as_str) == Some("compact_boundary")
    {
        return Some(compaction_message(entry, chat_id));
    }
    if entry_type == Some("result")
        && entry.get("subtype").and_then(Value::as_str) == Some("error_during_execution")
        && !matches!(entry.get("is_error"), Some(Value::Bool(false)))
    {
        return Some(ChatMessage {
            id: id_or_nanoid(entry),
            chat_id: chat_id.to_string(),
            r#type: ChatMessageType::Error,
            content: vec![MessageContent::Node(MessageContentNode::Error {
                message: "Session ended unexpectedly".to_string(),
                parent_tool_use_id: None,
            })],
            timestamp: timestamp_or_now(entry),
            metadata: meta_or_none(history_meta()),
        });
    }
    if entry_type != Some("user") && entry_type != Some("assistant") {
        return None;
    }
    let message = match entry.get("message") {
        Some(m) if js_truthy(Some(m)) => m,
        _ => return None,
    };
    if entry_type == Some("user") {
        return convert_user_entry(entry, message, chat_id);
    }
    if entry_type == Some("assistant") {
        return convert_assistant_entry(entry, message, chat_id, seen_api_message_ids);
    }
    None
}

#[path = "history_entry_helpers.rs"]
mod history_entry_helpers;
#[cfg(test)]
#[path = "history_converters_tests.rs"]
mod tests;
use history_entry_helpers::*;
#[path = "history_assistant_entry.rs"]
mod history_assistant_entry;
use history_assistant_entry::*;
#[path = "history_user_entry.rs"]
mod history_user_entry;
use history_user_entry::*;

fn compaction_message(entry: &Value, chat_id: &str) -> ChatMessage {
    let mut meta = history_meta();
    meta.insert("internal".to_string(), Value::Bool(true));
    ChatMessage {
        id: id_or_nanoid(entry),
        chat_id: chat_id.to_string(),
        r#type: ChatMessageType::System,
        content: vec![MessageContent::Node(MessageContentNode::Compaction {
            parent_tool_use_id: None,
        })],
        timestamp: timestamp_or_now(entry),
        metadata: Some(meta),
    }
}
