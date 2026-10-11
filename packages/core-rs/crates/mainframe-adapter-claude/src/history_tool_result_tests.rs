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
