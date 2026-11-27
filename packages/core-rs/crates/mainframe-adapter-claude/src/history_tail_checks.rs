//! What a tail read checks a message or entry for.
use std::collections::HashSet;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use serde_json::Value;

use crate::history::{
    convert_history_entry, is_strict_true, synthesize_unknown_command_from_user_entry,
};

/// A plain prompt: the loader keeps it as a user message through its usual
/// path, so reading from it leaves the turn state as in a full read.
pub(super) fn is_anchor(entry: &Value, session_id: &str) -> bool {
    entry.get("type").and_then(Value::as_str) == Some("user")
        && [
            "isMeta",
            "isCompactSummary",
            "isVisibleInTranscriptOnly",
            "isSidechain",
        ]
        .iter()
        .all(|key| !is_strict_true(entry.get(*key)))
        && synthesize_unknown_command_from_user_entry(entry, session_id).is_none()
        && convert_history_entry(entry, session_id, &mut HashSet::new())
            .is_some_and(|message| message.r#type == ChatMessageType::User)
}

/// A message the display opens a turn with.
pub(super) fn is_turn_start(message: &ChatMessage) -> bool {
    message.r#type == ChatMessageType::User
        && !message
            .metadata
            .as_ref()
            .and_then(|meta| meta.get("steered"))
            .is_some_and(|steered| steered == &Value::Bool(true))
}

pub(super) fn is_compaction_marker(message: &ChatMessage) -> bool {
    message.r#type == ChatMessageType::System
        && matches!(
            message.content.as_slice(),
            [MessageContent::Node(MessageContentNode::Compaction { .. })]
        )
}

/// A tool result in `messages` whose call is not among them.
pub(super) fn has_orphan_result(messages: &[ChatMessage]) -> bool {
    let nodes = || {
        messages
            .iter()
            .flat_map(|message| &message.content)
            .filter_map(|content| match content {
                MessageContent::Node(node) => Some(node),
                _ => None,
            })
    };
    let calls: HashSet<&str> = nodes()
        .filter_map(|node| match node {
            MessageContentNode::ToolUse { id, .. } => Some(id.as_str()),
            _ => None,
        })
        .collect();
    nodes().any(|node| {
        matches!(node, MessageContentNode::ToolResult { tool_use_id, .. }
            if !calls.contains(tool_use_id.as_str()))
    })
}
