//! ACP content blocks (schema `ContentBlock`) and streamed chunks
//! (`ContentChunk`), scoped to the `text` and `image` variants (spec
//! Decision 22): both have producers (`LeafContent::Text`/`Image`), while
//! `audio`/`resource`/`resource_link` stay out — no producer in any adapter
//! pipeline (spec Decision 17). Adding a variant is additive to this enum.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type MessageId = String;

/// `_meta` mirrors the schema's discipline of reserving it on essentially
/// every nested struct; Mainframe uses it for the namespaced truncation
/// marker on tool-result text (`extensions::TruncationMarker`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none", rename = "_meta")]
        meta: Option<Value>,
    },
    #[serde(rename_all = "camelCase")]
    Image {
        /// Base64-encoded media payload (schema `ImageContent.data`).
        data: String,
        mime_type: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        uri: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none", rename = "_meta")]
        meta: Option<Value>,
    },
}

/// One streamed item of message content (schema `ContentChunk`) — the
/// `user_message_chunk` / `agent_message_chunk` / `agent_thought_chunk`
/// `session/update` payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentChunk {
    pub message_id: MessageId,
    pub content: ContentBlock,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<Value>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn text_block_round_trips() {
        let v = json!({ "type": "text", "text": "hello" });
        let parsed: ContentBlock = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), v);
    }

    #[test]
    fn image_block_round_trips_minimal() {
        let v = json!({ "type": "image", "data": "aGk=", "mimeType": "image/png" });
        let parsed: ContentBlock = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), v);
    }

    #[test]
    fn image_block_round_trips_with_uri_and_meta() {
        let v = json!({
            "type": "image",
            "data": "aGk=",
            "mimeType": "image/jpeg",
            "uri": "file:///tmp/shot.jpg",
            "_meta": { "_mainframe.dev": { "source": "capture" } }
        });
        let parsed: ContentBlock = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), v);
    }
}
