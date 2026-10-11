//! Builds the stdin `user` payload for `ClaudeSession::send_message`.
//!
//! Extracted from `session.rs` so the payload shape has its own test surface: a
//! regression guard proving the `ImageInput.path` field — added for Codex —
//! never reaches Claude's stdin.

use mainframe_adapter_api::ImageInput;
use serde_json::{Value, json};

pub fn build_user_payload(
    chat_id: &str,
    message: &str,
    images: &[ImageInput],
    uuid: Option<&str>,
) -> Value {
    let mut content: Vec<Value> = Vec::new();
    for img in images {
        content.push(json!({
            "type": "image",
            "source": { "type": "base64", "media_type": img.media_type, "data": img.data },
        }));
    }
    if !message.is_empty() || content.is_empty() {
        content.push(json!({ "type": "text", "text": message }));
    }
    let mut payload = json!({
        "type": "user",
        "session_id": chat_id,
        "message": { "role": "user", "content": content },
        "parent_tool_use_id": null,
    });
    if let Some(u) = uuid {
        payload["uuid"] = Value::String(u.to_string());
    }
    payload
}

/// The text payload with `priority: "next"`, which the CLI drains at the
/// next tool boundary of the running turn.
pub(crate) fn build_steer_payload(chat_id: &str, message: &str, uuid: Option<&str>) -> Value {
    let mut payload = build_user_payload(chat_id, message, &[], uuid);
    payload["priority"] = Value::String("next".to_string());
    payload
}

#[cfg(test)]
#[path = "user_payload_tests.rs"]
mod tests;
