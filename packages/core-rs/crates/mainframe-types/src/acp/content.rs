//! ACP content blocks (schema `ContentBlock`) and streamed chunks
//! (`ContentChunk`), scoped to the `text` variant — the only block kind the
//! chat facade's text/thought streaming needs (spec: "Tool-input token deltas
//! beyond text/reasoning chunking" and image/audio prompt capabilities are
//! out of this task's frame list). `image`/`audio`/`resource`/`resource_link`
//! are not modeled; adding them is additive to this enum when a later task
//! needs them.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type MessageId = String;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text { text: String },
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
}
