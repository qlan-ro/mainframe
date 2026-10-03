use serde_json::Value;

use mainframe_adapter_api::SessionSink;
use mainframe_services::todos::normalize::{TodoSource, normalize_todos};
use mainframe_types::adapter::{MessageMetadata, MessageUsage};
use mainframe_types::chat::{MessageContent, TodoItem};
use mainframe_types::context::SkillFileEntry;

use crate::session::{ClaudeSession, ClaudeSessionState};
use crate::skill_path::resolve_skill_path;
pub(crate) fn blocks_to_message_content(blocks: &[Value]) -> Vec<MessageContent> {
    blocks
        .iter()
        .filter_map(
            |b| match serde_json::from_value::<MessageContent>(b.clone()) {
                Ok(mc) => Some(mc),
                Err(err) => {
                    tracing::warn!(
                        ?err,
                        "assistant event: unrepresentable content block skipped"
                    );
                    None
                }
            },
        )
        .collect()
}
fn has_representable_content(content: &[Value]) -> bool {
    content
        .iter()
        .any(|block| match block.get("type").and_then(Value::as_str) {
            Some("text") | Some("tool_use") => true,
            Some("thinking") => !block
                .get("thinking")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .is_empty(),
            _ => false,
        })
}

fn tag_block(block: &Value, parent_tool_use_id: &str) -> Value {
    let mut b = block.clone();
    if let Value::Object(map) = &mut b {
        map.insert(
            "parentToolUseId".to_string(),
            Value::String(parent_tool_use_id.to_string()),
        );
    }
    b
}
fn scan_attention_requests(content: &[Value], sink: &dyn SessionSink) {
    for block in content {
        if block.get("type").and_then(Value::as_str) != Some("tool_use") {
            continue;
        }
        if block.get("name").and_then(Value::as_str) != Some("PushNotification") {
            continue;
        }
        if let Some(message) = block
            .get("input")
            .and_then(|i| i.get("message"))
            .and_then(Value::as_str)
        {
            sink.on_attention_request(message);
        }
    }
}

pub fn handle_assistant_event(session: &ClaudeSession, event: &Value, sink: &dyn SessionSink) {
    let message = event.get("message");
    let usage = message.and_then(|m| m.get("usage"));

    if let Some(content) = message
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    {
        scan_attention_requests(content, sink);
    }

    let mut guard = session.state.lock().unwrap_or_else(|e| e.into_inner());
    let st: &mut ClaudeSessionState = &mut guard;

    if let Some(u) = usage {
        st.last_assistant_usage = serde_json::from_value::<MessageUsage>(u.clone()).ok();
    }
    let Some(content) = message
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    else {
        return;
    };
    if let Some(parent) = event
        .get("parent_tool_use_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        let tagged: Vec<Value> = content.iter().map(|b| tag_block(b, parent)).collect();
        let blocks = blocks_to_message_content(&tagged);
        drop(guard);
        sink.on_subagent_child(parent, blocks);
        return;
    }
    st.partial.clear_block();

    tools::scan_tools(session, st, content, sink);
    let api_message_id = message
        .and_then(|m| m.get("id"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let metadata = message_metadata(st, event, message, usage, content);
    if metadata.vendor_id.is_none() {
        st.presentation.invalidate(sink);
    }
    let context = presentation_context(st, event, api_message_id, &metadata, message, sink);
    let blocks = blocks_to_message_content(content);
    drop(guard);
    emit_message(blocks, metadata, context, sink);
}

#[path = "assistant_event_tools.rs"]
mod tools;

fn message_metadata(
    st: &mut ClaudeSessionState,
    event: &Value,
    message: Option<&Value>,
    usage: Option<&Value>,
    content: &[Value],
) -> MessageMetadata {
    let api_message_id = message
        .and_then(|m| m.get("id"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let vendor_id = match api_message_id {
        Some(mid)
            if has_representable_content(content)
                && st.seen_api_message_ids.insert(mid.to_string()) =>
        {
            Some(mid.to_string())
        }
        _ => event
            .get("uuid")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
    };
    MessageMetadata {
        model: message
            .and_then(|m| m.get("model"))
            .and_then(Value::as_str)
            .map(str::to_string),
        usage: usage.and_then(|u| serde_json::from_value::<MessageUsage>(u.clone()).ok()),
        vendor_id,
    }
}

fn emit_message(
    blocks: Vec<MessageContent>,
    metadata: MessageMetadata,
    context: Option<mainframe_types::transcript_presentation::TranscriptPresentation>,
    sink: &dyn SessionSink,
) {
    if let Some(context) = context {
        sink.on_message_with_presentation(blocks, Some(metadata), context);
    } else {
        sink.on_message(blocks, Some(metadata));
    }
}

fn presentation_context(
    st: &mut ClaudeSessionState,
    event: &Value,
    api_message_id: Option<&str>,
    metadata: &MessageMetadata,
    message: Option<&Value>,
    sink: &dyn SessionSink,
) -> Option<mainframe_types::transcript_presentation::TranscriptPresentation> {
    st.presentation.observe(
        event,
        api_message_id,
        metadata.vendor_id.as_deref(),
        message
            .and_then(|m| m.get("stop_reason"))
            .and_then(Value::as_str),
        sink,
    )
}
