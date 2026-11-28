//! Live-only events the golden adds on top of the transcript: provider
//! history carries neither tool timing nor turn-duration markers, so the
//! daemon appends them while a turn runs.

use mainframe_display::RawChange;
use mainframe_types::chat::ChatMessage;
use serde_json::json;

use super::transcript::CHAT_ID;

/// The timing a completed tool call gains, written onto its raw
/// `tool_use` block the way the message cache does, plus the matching change.
pub fn complete_tool_timing(raw: &mut [ChatMessage], tool_id: &str) -> RawChange {
    use mainframe_types::chat::{MessageContent, MessageContentNode};
    use mainframe_types::tool_call_timing::ToolCallTiming;
    let timing = ToolCallTiming {
        started_at: 1_793_000_000_000,
        completed_at: Some(1_793_000_002_500),
    };
    for block in raw
        .iter_mut()
        .flat_map(|message| message.content.iter_mut())
    {
        if let MessageContent::Node(MessageContentNode::ToolUse {
            id, timing: slot, ..
        }) = block
            && id == tool_id
        {
            *slot = Some(timing);
        }
    }
    RawChange::Timing(tool_id.to_string(), Some(timing))
}

/// The `turnDurationMs` marker a finished turn appends.
pub fn system_duration(id: &str, ms: u64) -> ChatMessage {
    serde_json::from_value(json!({
        "id": id,
        "chatId": CHAT_ID,
        "type": "system",
        "content": [],
        "timestamp": "2026-11-01T10:09:00.000Z",
        "metadata": { "turnDurationMs": ms },
    }))
    .unwrap()
}

/// A prompt the daemon appends live, with no images.
pub fn prompt(id: &str, text: &str) -> ChatMessage {
    serde_json::from_value(json!({
        "id": id,
        "chatId": CHAT_ID,
        "type": "user",
        "content": [{ "type": "text", "text": text }],
        "timestamp": "2026-11-01T10:10:00.000Z",
    }))
    .unwrap()
}
