//! Ported from `packages/core/src/plugins/builtin/claude/history-tool-result.ts`.
//!
//! Shared builders for turning a Claude JSONL `message.content` array plus its
//! `toolUseResult` sidecar into transcript `tool_result` blocks. The TS operates
//! on untyped `Record<string, unknown>`; the port navigates `serde_json::Value`
//! the same way. Also home to the small JS-semantics JSON helpers reused by the
//! history-converters / history-subagents siblings.

use mainframe_types::chat::{DiffHunk, MessageContent, MessageContentNode};
use serde_json::Value;

// ── shared JS-semantics helpers ─────────────────────────────────────────────

/// JS truthiness for a possibly-absent JSON value (`!!v`).
pub(crate) fn js_truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true, // arrays/objects are always truthy
    }
}

pub fn derive_modified_file(tur: Option<&Value>, original_file: Option<&str>) -> Option<String> {
    let tur = tur?;
    let tur_type = tur.get("type").and_then(Value::as_str);
    if let Some(Value::String(content)) = tur.get("content")
        && (tur_type == Some("create") || tur_type == Some("update"))
    {
        return Some(content.clone());
    }
    if let (Some(original), Some(Value::String(old_str))) = (original_file, tur.get("oldString")) {
        let new_str = tur
            .get("newString")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        return Some(if js_truthy(tur.get("replaceAll")) {
            // `.split(oldStr).join(newStr)` — replace ALL occurrences.
            original.replace(old_str, &new_str)
        } else {
            // `.replace(oldStr, newStr)` — replace the FIRST occurrence only.
            original.replacen(old_str, &new_str, 1)
        });
    }
    None
}

pub fn extract_tool_result_content(content: Option<&Value>) -> String {
    // `JSON.stringify(content ?? '')`: null/absent → '' → `""`.
    let Some(value) = content else {
        return "\"\"".to_string();
    };
    match value {
        Value::String(s) => s.clone(),
        Value::Array(arr) => {
            let mut texts: Vec<String> = Vec::new();
            for block in arr {
                if let Some(Value::String(t)) = block.get("text") {
                    texts.push(t.clone());
                }
            }
            if !texts.is_empty() {
                return texts.join("\n");
            }
            // `JSON.stringify(content)` on a non-text array.
            serde_json::to_string(value).unwrap_or_default()
        }
        Value::Null => "\"\"".to_string(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

pub fn build_tool_result_blocks(message: &Value, tur: Option<&Value>) -> Vec<MessageContent> {
    let raw_content = match message.get("content") {
        Some(Value::Array(arr)) => arr,
        _ => return Vec::new(),
    };

    let sp: Option<Vec<DiffHunk>> = tur
        .and_then(|t| t.get("structuredPatch"))
        .and_then(Value::as_array)
        .filter(|a| !a.is_empty())
        .and_then(|a| serde_json::from_value::<Vec<DiffHunk>>(Value::Array(a.clone())).ok());
    let original_file = tur
        .and_then(|t| t.get("originalFile"))
        .and_then(Value::as_str);
    let modified_file = derive_modified_file(tur, original_file);

    let mut blocks: Vec<MessageContent> = Vec::new();
    for block in raw_content {
        if block.get("type").and_then(Value::as_str) != Some("tool_result") {
            continue;
        }
        blocks.push(MessageContent::Node(MessageContentNode::ToolResult {
            tool_use_id: block
                .get("tool_use_id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .unwrap_or("")
                .to_string(),
            content: extract_tool_result_content(block.get("content")),
            is_error: js_truthy(block.get("is_error")),
            structured_patch: sp.clone(),
            original_file: original_file.map(str::to_string),
            modified_file: modified_file.clone(),
            parent_tool_use_id: None,
        }));
    }
    blocks
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_string_content() {
        assert_eq!(extract_tool_result_content(Some(&json!("hello"))), "hello");
    }

    #[test]
    fn extract_flattens_text_blocks() {
        let c = json!([{ "type": "text", "text": "A" }, { "type": "text", "text": "B" }]);
        assert_eq!(extract_tool_result_content(Some(&c)), "A\nB");
    }

    #[test]
    fn extract_null_becomes_empty_json_string() {
        assert_eq!(extract_tool_result_content(None), "\"\"");
        assert_eq!(extract_tool_result_content(Some(&Value::Null)), "\"\"");
    }

    #[test]
    fn derive_modified_from_create_content() {
        let tur = json!({ "type": "create", "content": "new file body" });
        assert_eq!(
            derive_modified_file(Some(&tur), None),
            Some("new file body".to_string())
        );
    }

    #[test]
    fn derive_modified_from_edit_first_occurrence() {
        let tur = json!({ "oldString": "a", "newString": "b" });
        assert_eq!(
            derive_modified_file(Some(&tur), Some("a a")),
            Some("b a".to_string())
        );
    }

    #[test]
    fn derive_modified_replace_all() {
        let tur = json!({ "oldString": "a", "newString": "b", "replaceAll": true });
        assert_eq!(
            derive_modified_file(Some(&tur), Some("a a")),
            Some("b b".to_string())
        );
    }

    #[test]
    fn build_blocks_filters_to_tool_results() {
        let message = json!({
            "content": [
                { "type": "text", "text": "ignore" },
                { "type": "tool_result", "tool_use_id": "tu_1", "content": "OK", "is_error": false }
            ]
        });
        let blocks = build_tool_result_blocks(&message, None);
        assert_eq!(blocks.len(), 1);
        match &blocks[0] {
            MessageContent::Node(MessageContentNode::ToolResult {
                tool_use_id,
                content,
                is_error,
                ..
            }) => {
                assert_eq!(tool_use_id, "tu_1");
                assert_eq!(content, "OK");
                assert!(!is_error);
            }
            _ => panic!("expected tool_result"),
        }
    }
}

// PORT STATUS: src/plugins/builtin/claude/history-tool-result.ts (58 lines)
// confidence: high
// todos: 0
// notes: operates on serde_json::Value like the TS Record<string,unknown>.
// structuredPatch is deserialized to Vec<DiffHunk> (TS casts blindly); malformed
// hunks are dropped rather than passed through raw (typed MessageContent can't
// hold arbitrary JSON) — CLI shape is stable. js_truthy/get are pub(crate) so
// history-converters/history-subagents share them (3+ call sites) without a new
// module file. WIRE NOTE: the JSON.stringify fallback for object-shaped
// tool_result content uses serde_json (BTreeMap-sorted keys) vs JS insertion
// order — untested edge; the covered paths are string + text-array.
