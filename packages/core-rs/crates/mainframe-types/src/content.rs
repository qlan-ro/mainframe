//! Ported from `packages/types/src/content.ts`.
//!
//! `LeafContent` is the set of leaf content variants shared verbatim between the
//! transcript-form `MessageContent` (`chat.rs`) and the UI-render-form
//! `DisplayContent` (`display.rs`). Factoring them here keeps the two unions in
//! lockstep, exactly as the TS source does. `parentToolUseId` tags a block as
//! originating from a subagent stream event.

use serde::{Deserialize, Serialize};

/// Leaf content variants shared between `MessageContent` and `DisplayContent`.
///
/// Internally tagged on `type`; every variant carries an optional
/// `parentToolUseId` (omitted when absent).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum LeafContent {
    Text {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    Thinking {
        thinking: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    Image {
        media_type: String,
        data: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    SkillLoaded {
        skill_name: String,
        path: String,
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
}

/// One base64-encoded image carried on a `tool_result` (todo #363), in the
/// order the CLI's `content` array presented it. Shared between the
/// transcript-form `MessageContentNode::ToolResult` (`chat.rs`) and the
/// UI-render-form `ToolCallResult` (`display.rs`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultImage {
    pub media_type: String,
    pub data: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn roundtrip(v: Value) {
        let leaf: LeafContent = serde_json::from_value(v.clone()).unwrap();
        let back = serde_json::to_value(&leaf).unwrap();
        assert_eq!(v, back);
    }

    #[test]
    fn text_minimal_omits_parent() {
        let v = json!({ "type": "text", "text": "hello" });
        roundtrip(v.clone());
        // Absent parentToolUseId must not serialize as null.
        let leaf: LeafContent = serde_json::from_value(v).unwrap();
        let s = serde_json::to_string(&leaf).unwrap();
        assert!(!s.contains("parentToolUseId"));
    }

    #[test]
    fn image_snake_field_renamed_to_camel() {
        let v = json!({
            "type": "image",
            "mediaType": "image/png",
            "data": "AAAA",
            "parentToolUseId": "toolu_01A"
        });
        roundtrip(v);
    }

    #[test]
    fn skill_loaded_full() {
        let v = json!({
            "type": "skill_loaded",
            "skillName": "pdf",
            "path": "/skills/pdf",
            "content": "# PDF"
        });
        roundtrip(v);
    }

    #[test]
    fn tool_result_image_camel_case_roundtrip() {
        let v = json!({ "mediaType": "image/png", "data": "AAAA" });
        let img: ToolResultImage = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(serde_json::to_value(&img).unwrap(), v);
    }
}

// PORT STATUS: packages/types/src/content.ts (16 lines)
// confidence: high
// todos: 0
// notes: LeafContent is an internally-tagged enum (tag "type"); tag values are
// snake_case (text/thinking/image/skill_loaded) via rename_all, wire fields are
// camelCase via rename_all_fields. parentToolUseId is on every variant and is
// omit-when-absent. Reused by chat::MessageContent and display::DisplayContent
// as the `Leaf` arm of their untagged wrappers.
