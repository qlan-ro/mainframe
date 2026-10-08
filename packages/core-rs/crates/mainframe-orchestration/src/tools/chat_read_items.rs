//! `chat_read`'s item model: one item per cached `ChatMessage`, rendered as
//! bounded text, plus the opaque `<position>:<messageId>` cursor.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use serde_json::{Value, json};

use crate::errors::cap_chars;
use crate::state::is_agent_message;

const TOOL_INPUT_SUMMARY_CHARS: usize = 200;

pub(super) struct Item {
    pub position: usize,
    pub message_id: String,
    pub role: &'static str,
    pub origin: &'static str,
    pub tool_name: Option<String>,
    pub text: String,
    pub timestamp: String,
}

/// The item for `messages[position]`, or `None` when the view skips it
/// (`messages` keeps only user and assistant text).
pub(super) fn to_item(position: usize, msg: &ChatMessage, activity: bool) -> Option<Item> {
    let role = match msg.r#type {
        ChatMessageType::User => "user",
        ChatMessageType::Assistant => "assistant",
        ChatMessageType::ToolUse | ChatMessageType::ToolResult => "tool",
        ChatMessageType::Permission => "permission",
        ChatMessageType::System => "system",
        ChatMessageType::Error => "error",
    };
    let conversational = matches!(role, "user" | "assistant");
    if !activity && !conversational {
        return None;
    }
    let mut parts = Vec::new();
    let mut tool_name = None;
    for block in &msg.content {
        if let Some((part, name)) = render_block(block, activity) {
            if tool_name.is_none() {
                tool_name = name;
            }
            parts.push(part);
        }
    }
    let text = parts.join("\n");
    if text.trim().is_empty() {
        return None;
    }
    let origin = match role {
        "user" if is_agent_message(&text) => "agent",
        "user" => "human",
        "assistant" | "tool" => "provider",
        _ => "mainframe",
    };
    Some(Item {
        position,
        message_id: msg.id.clone(),
        role,
        origin,
        tool_name,
        text,
        timestamp: msg.timestamp.clone(),
    })
}

fn render_block(block: &MessageContent, activity: bool) -> Option<(String, Option<String>)> {
    match block {
        MessageContent::Leaf(LeafContent::Text { text, .. }) => Some((text.clone(), None)),
        MessageContent::Leaf(_) => None,
        MessageContent::Node(node) if activity => render_node(node),
        MessageContent::Node(_) => None,
    }
}

fn render_node(node: &MessageContentNode) -> Option<(String, Option<String>)> {
    match node {
        MessageContentNode::ToolUse { name, input, .. } => {
            let input = serde_json::to_string(input).unwrap_or_default();
            let summary = cap_chars(&input, TOOL_INPUT_SUMMARY_CHARS);
            Some((format!("[tool call {name}] {summary}"), Some(name.clone())))
        }
        MessageContentNode::ToolResult {
            content, is_error, ..
        } => {
            let label = if *is_error {
                "[tool error]"
            } else {
                "[tool result]"
            };
            Some((format!("{label} {content}"), None))
        }
        MessageContentNode::PermissionRequest { request, .. } => Some((
            format!("[permission request {}]", request.tool_name),
            Some(request.tool_name.clone()),
        )),
        MessageContentNode::Error { message, .. } => Some((message.clone(), None)),
        MessageContentNode::Compaction { .. } => Some(("[context compacted]".into(), None)),
        MessageContentNode::ProviderSwitch { marker } => Some((
            format!(
                "[switched from {} to {}]",
                marker.from_adapter_name, marker.to_adapter_name
            ),
            None,
        )),
    }
}

/// Renders `item` from char `offset`, cut to `max_chars`.
pub(super) fn render(item: &Item, offset: usize, max_chars: usize) -> Value {
    let total = item.text.chars().count();
    let start = offset.min(total);
    let slice: String = item.text.chars().skip(start).take(max_chars).collect();
    let end = start + slice.chars().count();
    let truncated = end < total;
    json!({
        "position": item.position,
        "messageId": item.message_id,
        "role": item.role,
        "origin": item.origin,
        "toolName": item.tool_name,
        "text": slice,
        "textTruncated": truncated,
        "nextTextOffset": if truncated { json!(end) } else { Value::Null },
        "timestamp": item.timestamp,
    })
}

pub(super) fn encode_cursor(position: usize, message_id: &str) -> String {
    URL_SAFE_NO_PAD.encode(format!("{position}:{message_id}"))
}

pub(super) fn decode_cursor(cursor: &str) -> Option<(usize, String)> {
    let raw = URL_SAFE_NO_PAD.decode(cursor).ok()?;
    let raw = String::from_utf8(raw).ok()?;
    let (position, id) = raw.split_once(':')?;
    Some((position.parse().ok()?, id.to_string()))
}

/// The position a cursor points at now: its recorded position when the id
/// still sits there, else wherever the id moved (a cancelled queued message
/// or a rewind shifts positions), else `None`.
pub(super) fn locate(messages: &[ChatMessage], position: usize, id: &str) -> Option<usize> {
    if messages.get(position).is_some_and(|m| m.id == id) {
        return Some(position);
    }
    messages.iter().position(|m| m.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_round_trips() {
        let cursor = encode_cursor(7, "msg-1");
        assert_eq!(decode_cursor(&cursor), Some((7, "msg-1".to_string())));
        assert_eq!(decode_cursor("!!!"), None);
    }

    #[test]
    fn a_provider_switch_reads_as_a_one_line_marker() {
        let marker = mainframe_types::segment::ProviderSwitchMarker {
            segment_id: "seg-2".into(),
            kind: mainframe_types::segment::SegmentKind::ProviderSwitch,
            from_adapter_id: "claude".into(),
            to_adapter_id: "codex".into(),
            from_adapter_name: "Claude".into(),
            to_adapter_name: "Codex".into(),
            to_model: None,
            resumed: false,
            previous: Default::default(),
            handoff: None,
        };
        let block = MessageContent::Node(MessageContentNode::ProviderSwitch { marker });

        assert_eq!(
            render_block(&block, true),
            Some(("[switched from Claude to Codex]".to_string(), None))
        );
        assert_eq!(render_block(&block, false), None);
    }
}
