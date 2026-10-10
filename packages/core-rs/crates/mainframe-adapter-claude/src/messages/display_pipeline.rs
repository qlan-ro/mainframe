//! Transforms raw `ChatMessage[]` into display-ready `DisplayMessage[]`.
//!
//! CRATE-SPLIT NOTE (PORTING §2.5 amendment): REASSIGNED from mainframe-display to
//! this crate together with `display_helpers` — it composes the Claude-specific
//! grouping/helpers (`group_messages`, `convert_assistant_content`, …) plus the
//! Claude `task_subject_backfill`. See `display_helpers.rs` for the split rationale.

use std::collections::HashSet;

use mainframe_types::chat::{ChatMessage, ChatMessageType};
use mainframe_types::display::{
    DisplayMessage, DisplayMessageType, ToolCategories, has_attachment_evidence,
};

use super::display_helpers::{apply_tool_grouping, convert_user_content, is_internal_user_message};
use super::message_grouping::{GroupedMessage, group_messages};
use super::task_subject_backfill::backfill_task_subjects;

/// Pipeline steps:
/// 1. Filter internal user messages (mainframe commands, skill markers)
/// 2. Group consecutive assistant/tool_use turns, attach tool_results
/// 3. Handle turnDurationMs system markers
/// 4. Convert each grouped message to DisplayMessage
/// 5. Apply tool grouping when categories are provided
pub fn prepare_messages_for_client(
    messages: &[ChatMessage],
    categories: Option<&ToolCategories>,
) -> Vec<DisplayMessage> {
    if messages.is_empty() {
        return Vec::new();
    }

    // Step 1: Filter internal user messages
    let filtered: Vec<ChatMessage> = messages
        .iter()
        .filter(|msg| {
            !(msg.r#type == ChatMessageType::User && is_internal_user_message(&msg.content))
        })
        .cloned()
        .collect();

    // Steps 2–3: Group consecutive assistant turns, attach tool_results,
    // handle turnDurationMs (all handled by group_messages)
    let grouped = group_messages(filtered);

    // Steps 4–5: Convert to DisplayMessage, deduplicating by id. The CLI can reuse
    // UUIDs (e.g. compact_boundary entries), which crashes assistant-ui's
    // MessageRepository on duplicate ids.
    let mut result: Vec<DisplayMessage> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for g_msg in &grouped {
        let display = match convert_grouped_to_display(g_msg, categories) {
            Some(d) => d,
            None => continue,
        };
        if seen_ids.contains(&display.id) {
            continue;
        }
        seen_ids.insert(display.id.clone());
        result.push(display);
    }

    // Cross-message pass: name TaskUpdate items whose TaskCreate lives in an
    // earlier grouped message (the CLI's update events carry no subject).
    let mut result = backfill_task_subjects(&result);
    mainframe_display::apply_tool_call_timing(messages, &mut result);
    result
}

/// `pub(crate)` (todo #376): the incremental projector calls this per group
/// directly, so a patched or freshly refolded group produces byte-identical
/// `DisplayMessage` content to the full pipeline that calls it here.
pub(crate) fn convert_grouped_to_display(
    msg: &GroupedMessage,
    categories: Option<&ToolCategories>,
) -> Option<DisplayMessage> {
    let id = msg.base.id.clone();
    let chat_id = msg.base.chat_id.clone();
    let timestamp = msg.base.timestamp.clone();

    match msg.base.r#type {
        ChatMessageType::Assistant | ChatMessageType::ToolUse => {
            convert_assistant_message(msg, categories)
        }

        ChatMessageType::User => {
            let (display_content, extra_meta) = convert_user_content(&msg.base.content);
            // Suppress user messages whose entire content was stripped to nothing
            // (bare <command-name> CLI echoes with no visible text/images/results),
            // unless attachment evidence in metadata proves this was a real,
            // attachment-only send rather than internal CLI plumbing.
            if display_content.is_empty()
                && extra_meta.is_empty()
                && !has_attachment_evidence(msg.base.metadata.as_ref())
            {
                return None;
            }
            let mut metadata = msg.base.metadata.clone().unwrap_or_default();
            metadata.extend(extra_meta);
            Some(DisplayMessage {
                id,
                chat_id,
                r#type: DisplayMessageType::User,
                content: display_content,
                timestamp,
                metadata: if metadata.is_empty() {
                    None
                } else {
                    Some(metadata)
                },
            })
        }

        ChatMessageType::System | ChatMessageType::Error | ChatMessageType::Permission => {
            Some(super::display_pipeline_markers::convert_marker(msg))
        }

        // Orphan tool_result without a preceding assistant/tool_use — suppress.
        ChatMessageType::ToolResult => None,
    }
}

fn convert_assistant_message(
    msg: &GroupedMessage,
    categories: Option<&ToolCategories>,
) -> Option<DisplayMessage> {
    let (mut content, mut sources) =
        super::display_assistant::convert_assistant_with_sources(msg, categories);
    if let Some(cats) = categories {
        let grouped = apply_tool_grouping(content.clone(), cats);
        sources = super::presentation_display::regroup(&content, &grouped, sources);
        content = grouped;
    }
    let mut metadata = msg.base.metadata.clone();
    if !sources.is_empty() {
        super::presentation_grouping::store(metadata.get_or_insert_default(), sources);
    }
    Some(DisplayMessage {
        id: msg.base.id.clone(),
        chat_id: msg.base.chat_id.clone(),
        r#type: DisplayMessageType::Assistant,
        content,
        timestamp: msg.base.timestamp.clone(),
        metadata,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn txt(t: &str) -> Value {
        json!({ "type": "text", "text": t })
    }
    fn tu(id: &str, name: &str, input: Value) -> Value {
        json!({ "type": "tool_use", "id": id, "name": name, "input": input })
    }
    fn tr(tool_use_id: &str, content: &str, is_error: bool) -> Value {
        json!({ "type": "tool_result", "toolUseId": tool_use_id, "content": content, "isError": is_error })
    }

    fn raw_msg(counter: &mut i64, t: &str, content: Vec<Value>, overrides: Value) -> ChatMessage {
        *counter += 1;
        let mut obj = json!({
            "id": format!("msg-{}", *counter),
            "chatId": "chat-1",
            "type": t,
            "content": content,
            "timestamp": format!("2026-01-01T00:00:{:02}.000Z", *counter),
        });
        if let (Value::Object(map), Value::Object(over)) = (&mut obj, overrides) {
            for (k, v) in over {
                map.insert(k, v);
            }
        }
        serde_json::from_value(obj).unwrap()
    }

    fn test_categories() -> ToolCategories {
        serde_json::from_value(json!({
            "explore": ["Read", "Glob", "Grep"],
            "hidden": ["TodoWrite", "Skill"],
            "progress": ["TaskCreate", "TaskUpdate"],
            "subagent": ["Task"],
        }))
        .unwrap()
    }

    fn content_json(m: &DisplayMessage) -> Value {
        serde_json::to_value(&m.content).unwrap()
    }

    include!("display_pipeline_tests/basic.rs");
    include!("display_pipeline_tests/markers.rs");
    include!("display_pipeline_tests/attachments.rs");
}
#[cfg(test)]
mod tool_timing_tests;
