//! What a tail read checks a message or entry for.
use std::collections::{HashMap, HashSet};

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::task_progress::extract_task_id;
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

/// A record that becomes a message, and that the loader would have to give an
/// id or a time of its own: it would differ from one read to the next. That
/// is a user or assistant record, a compact boundary, or a queued prompt.
pub(super) fn lacks_identity(entry: &Value) -> bool {
    let text = |key| {
        entry
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty())
    };
    let kept = match entry.get("type").and_then(Value::as_str) {
        Some("user" | "assistant") => true,
        Some("system") => entry.get("subtype").and_then(Value::as_str) == Some("compact_boundary"),
        Some("attachment") => {
            entry.pointer("/attachment/type").and_then(Value::as_str) == Some("queued_command")
        }
        _ => false,
    };
    kept && !(text("uuid") && text("timestamp"))
}

/// A task update with no subject of its own whose task is not created, or
/// renamed, within `messages`. The display names it from the creating call,
/// so a window that cut that call off would show it differently. A creation
/// whose result carries no id is numbered by its place in the whole list.
pub(super) fn has_unresolved_task_update(messages: &[ChatMessage]) -> bool {
    let nodes = || {
        messages
            .iter()
            .flat_map(|message| &message.content)
            .filter_map(|content| match content {
                MessageContent::Node(node) => Some(node),
                _ => None,
            })
    };
    let results: HashMap<&str, &str> = nodes()
        .filter_map(|node| match node {
            MessageContentNode::ToolResult {
                tool_use_id,
                content,
                ..
            } => Some((tool_use_id.as_str(), content.as_str())),
            _ => None,
        })
        .collect();
    let mut known: HashSet<String> = HashSet::new();
    nodes().any(|node| match node {
        MessageContentNode::ToolUse {
            id, name, input, ..
        } => task_call_unresolved(id, name, input, &results, &mut known),
        _ => false,
    })
}

/// Records what a task call creates or renames in `known`; whether it needs
/// a task `known` does not hold.
fn task_call_unresolved(
    id: &str,
    name: &str,
    input: &HashMap<String, Value>,
    results: &HashMap<&str, &str>,
    known: &mut HashSet<String>,
) -> bool {
    match name {
        "TaskCreate" => {
            let created = results
                .get(id)
                .and_then(|content| extract_task_id(&Value::String((*content).to_owned())));
            created.is_none_or(|task| {
                known.insert(task);
                false
            })
        }
        "TaskUpdate" => {
            let task = match input.get("taskId") {
                Some(Value::String(task)) => task.clone(),
                Some(Value::Null) | None => String::new(),
                Some(other) => other.to_string(),
            };
            let renamed = input
                .get("subject")
                .and_then(Value::as_str)
                .is_some_and(|subject| !subject.is_empty());
            if task.is_empty() {
                false
            } else if renamed {
                known.insert(task);
                false
            } else {
                !known.contains(&task)
            }
        }
        _ => false,
    }
}
