//! Builds the stdin `user` payload for `ClaudeSession::send_message`.
//!
//! Extracted from `session.rs` so the payload shape has its own test surface
//! (todo #300 group C): a regression guard proving the new `ImageInput.path`
//! field — added for Codex — never reaches Claude's stdin.

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

#[cfg(test)]
mod tests {
    use mainframe_adapter_api::ImageInput;

    fn image_with_path(media_type: &str, data: &str, path: &str) -> ImageInput {
        ImageInput {
            media_type: media_type.to_string(),
            data: data.to_string(),
            path: Some(path.to_string()),
        }
    }

    #[test]
    fn image_block_precedes_the_text_block() {
        let images = vec![image_with_path("image/png", "AAA", "/tmp/a.png")];
        let payload = super::build_user_payload("chat-1", "hi", &images, None);

        assert_eq!(
            payload["message"]["content"],
            serde_json::json!([
                {
                    "type": "image",
                    "source": { "type": "base64", "media_type": "image/png", "data": "AAA" },
                },
                { "type": "text", "text": "hi" },
            ])
        );
    }

    #[test]
    fn empty_message_with_an_image_emits_no_text_block() {
        let images = vec![image_with_path("image/png", "AAA", "/tmp/a.png")];
        let payload = super::build_user_payload("chat-1", "", &images, None);

        assert_eq!(
            payload["message"]["content"],
            serde_json::json!([
                {
                    "type": "image",
                    "source": { "type": "base64", "media_type": "image/png", "data": "AAA" },
                },
            ])
        );
    }

    #[test]
    fn empty_message_without_images_still_emits_one_empty_text_block() {
        let payload = super::build_user_payload("chat-1", "", &[], None);

        assert_eq!(
            payload["message"]["content"],
            serde_json::json!([{ "type": "text", "text": "" }])
        );
    }

    #[test]
    fn uuid_is_attached_when_present_and_absent_otherwise() {
        let with_uuid = super::build_user_payload("chat-1", "hi", &[], Some("uuid-1"));
        assert_eq!(with_uuid["uuid"], serde_json::json!("uuid-1"));

        let without_uuid = super::build_user_payload("chat-1", "hi", &[], None);
        assert!(without_uuid.get("uuid").is_none());
    }

    #[test]
    fn envelope_keeps_type_session_id_and_null_parent_tool_use_id() {
        let payload = super::build_user_payload("chat-1", "hi", &[], None);

        assert_eq!(payload["type"], serde_json::json!("user"));
        assert_eq!(payload["session_id"], serde_json::json!("chat-1"));
        assert_eq!(payload["message"]["role"], serde_json::json!("user"));
        assert_eq!(payload["parent_tool_use_id"], serde_json::json!(null));
    }
}
