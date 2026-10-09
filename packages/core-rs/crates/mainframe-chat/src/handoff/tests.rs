//! Shared fixtures for the handoff module's tests; each concern has its own
//! file below.

mod budget_tests;
mod build_tests;
mod items_tests;
mod plan_tests;
mod render_tests;
mod select_tests;

use std::collections::HashMap;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use serde_json::{Value, json};

use super::items::{HandoffItem, ItemKind};

pub(super) fn msg(id: &str, kind: ChatMessageType, content: Vec<MessageContent>) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "chat_1".to_string(),
        r#type: kind,
        content,
        timestamp: "2026-10-06T00:00:00Z".to_string(),
        metadata: None,
    }
}

pub(super) fn text(s: &str) -> MessageContent {
    MessageContent::Leaf(LeafContent::Text {
        text: s.to_string(),
        parent_tool_use_id: None,
    })
}

pub(super) fn user(id: &str, s: &str) -> ChatMessage {
    msg(id, ChatMessageType::User, vec![text(s)])
}

pub(super) fn assistant(id: &str, s: &str) -> ChatMessage {
    msg(id, ChatMessageType::Assistant, vec![text(s)])
}

pub(super) fn tool_use(id: &str, name: &str, input: Value) -> MessageContent {
    let input: HashMap<String, Value> = serde_json::from_value(input).unwrap();
    MessageContent::Node(MessageContentNode::ToolUse {
        timing: None,
        command_execution: None,
        id: id.to_string(),
        name: name.to_string(),
        input,
        parent_tool_use_id: None,
    })
}

pub(super) fn tool_result(id: &str, content: &str, is_error: bool) -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolResult {
        tool_use_id: id.to_string(),
        content: content.to_string(),
        is_error,
        structured_patch: None,
        original_file: None,
        modified_file: None,
        images: Vec::new(),
        parent_tool_use_id: None,
    })
}

pub(super) fn call(
    id: &str,
    name: &str,
    input: Value,
    result: Option<(&str, bool)>,
) -> Vec<ChatMessage> {
    let mut out = vec![msg(
        &format!("{id}-use"),
        ChatMessageType::Assistant,
        vec![tool_use(id, name, input)],
    )];
    if let Some((content, is_error)) = result {
        out.push(msg(
            &format!("{id}-res"),
            ChatMessageType::ToolResult,
            vec![tool_result(id, content, is_error)],
        ));
    }
    out
}

pub(super) fn item(kind: ItemKind, turn: u32, text: &str) -> HandoffItem {
    HandoffItem {
        kind,
        turn,
        provider: "Claude".to_string(),
        text: text.to_string(),
    }
}

pub(super) fn bash(cmd: &str) -> Value {
    json!({ "command": cmd })
}
