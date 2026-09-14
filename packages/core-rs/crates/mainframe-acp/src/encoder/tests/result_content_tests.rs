//! Diff and truncation result-content cases, split out of `tests.rs`
//! (todo #350, plan task 37, R2.13).

use std::collections::HashMap;

use mainframe_types::display::{
    DisplayContent, DisplayMessageType, DisplayNode, ToolCallResult, ToolCategory,
};

use super::*;
fn edit_diff_content() -> mainframe_types::acp::tool_call::Diff {
    let mut input = HashMap::new();
    input.insert("file_path".to_string(), json!("/w/src/config.json"));
    input.insert("old_string".to_string(), json!("false"));
    input.insert("new_string".to_string(), json!("true"));
    let messages = vec![dmsg(
        "dmsg_6",
        DisplayMessageType::Assistant,
        vec![DisplayContent::Node(DisplayNode::ToolCall {
            id: "toolu_edit_1".to_string(),
            name: "Edit".to_string(),
            input,
            category: ToolCategory::Default,
            result: Some(ToolCallResult {
                content: "Applied 1 edit".to_string(),
                is_error: false,
                structured_patch: Some(vec![mainframe_types::chat::DiffHunk {
                    old_start: 1,
                    old_lines: 1,
                    new_start: 1,
                    new_lines: 1,
                    lines: vec!["-false".to_string(), "+true".to_string()],
                }]),
                original_file: Some("false".to_string()),
                modified_file: Some("true".to_string()),
                truncated: None,
                full_bytes: None,
                ask_user_question: None,
            }),
            parent_tool_use_id: None,
        })],
    )];

    let items = encode(&messages);
    let EncodedItem::ToolCall { content, .. } = &items[0] else {
        panic!("expected a tool-call item");
    };
    assert_eq!(content.len(), 2);
    assert!(matches!(&content[0], ToolCallContent::Content { .. }));
    let ToolCallContent::Diff(diff) = &content[1] else {
        panic!("expected a diff content entry");
    };
    diff.clone()
}

#[test]
fn an_edit_result_with_structured_hunks_encodes_the_changed_path_and_file_type() {
    let diff = edit_diff_content();
    assert_eq!(
        serde_json::to_value(&diff.changes).unwrap(),
        json!([{ "operation": "modify", "path": "/w/src/config.json", "fileType": "text" }])
    );
}

#[test]
fn an_edit_result_with_structured_hunks_encodes_a_unified_diff_patch_text() {
    let diff = edit_diff_content();
    let patch = diff.patch.as_ref().expect("patch text expected");
    assert_eq!(
        patch.text,
        "diff --git /w/src/config.json /w/src/config.json\n\
         --- /w/src/config.json\n\
         +++ /w/src/config.json\n\
         @@ -1,1 +1,1 @@\n\
         -false\n\
         +true\n"
    );
}

#[test]
fn an_edit_result_with_structured_hunks_carries_fidelity_meta() {
    let diff = edit_diff_content();
    let fidelity = &diff.meta.as_ref().unwrap()["_mainframe.dev"];
    assert_eq!(
        fidelity["structuredPatch"][0]["lines"],
        json!(["-false", "+true"])
    );
    assert_eq!(fidelity["originalFile"], json!("false"));
    assert_eq!(fidelity["modifiedFile"], json!("true"));
}

#[test]
fn a_write_result_with_hunks_and_no_pre_image_encodes_an_add_diff() {
    let mut input = HashMap::new();
    input.insert("file_path".to_string(), json!("/w/src/new.ts"));
    let messages = vec![dmsg(
        "dmsg_7",
        DisplayMessageType::Assistant,
        vec![DisplayContent::Node(DisplayNode::ToolCall {
            id: "toolu_write_1".to_string(),
            name: "Write".to_string(),
            input,
            category: ToolCategory::Default,
            result: Some(ToolCallResult {
                content: "OK".to_string(),
                is_error: false,
                structured_patch: Some(vec![mainframe_types::chat::DiffHunk {
                    old_start: 0,
                    old_lines: 0,
                    new_start: 1,
                    new_lines: 1,
                    lines: vec!["+const a = 1".to_string()],
                }]),
                original_file: None,
                modified_file: None,
                truncated: None,
                full_bytes: None,
                ask_user_question: None,
            }),
            parent_tool_use_id: None,
        })],
    )];

    let items = encode(&messages);
    let EncodedItem::ToolCall { content, .. } = &items[0] else {
        panic!("expected a tool-call item");
    };
    let ToolCallContent::Diff(diff) = &content[1] else {
        panic!("expected a diff content entry");
    };
    assert_eq!(
        serde_json::to_value(&diff.changes).unwrap(),
        json!([{ "operation": "add", "path": "/w/src/new.ts", "fileType": "text" }])
    );
    assert!(
        diff.patch
            .as_ref()
            .unwrap()
            .text
            .contains("--- /dev/null\n")
    );
}

#[test]
fn a_truncated_result_marks_its_text_block_with_the_namespaced_marker() {
    let messages = vec![dmsg(
        "dmsg_7",
        DisplayMessageType::Assistant,
        vec![DisplayContent::Node(DisplayNode::ToolCall {
            id: "toolu_9".to_string(),
            name: "Bash".to_string(),
            input: HashMap::new(),
            category: ToolCategory::Default,
            result: Some(ToolCallResult {
                content: "head\n…[truncated · 142 KB — expand]…\ntail".to_string(),
                is_error: false,
                structured_patch: None,
                original_file: None,
                modified_file: None,
                truncated: Some(true),
                full_bytes: Some(145_728),
                ask_user_question: None,
            }),
            parent_tool_use_id: None,
        })],
    )];

    let items = encode(&messages);
    let EncodedItem::ToolCall { content, .. } = &items[0] else {
        panic!("expected a tool call");
    };
    let ToolCallContent::Content {
        content: ContentBlock::Text { meta, .. },
    } = &content[0]
    else {
        panic!("expected a text content entry");
    };
    assert_eq!(
        meta.as_ref().unwrap()["_mainframe.dev"],
        json!({ "truncated": true, "fullBytes": 145_728 })
    );
}

#[test]
fn an_untruncated_result_text_block_carries_no_meta() {
    let items = encode(&[dmsg(
        "dmsg_8",
        DisplayMessageType::Assistant,
        vec![tool_call(
            "toolu_1",
            "Read",
            ToolCategory::Explore,
            Some("ok"),
        )],
    )]);
    let EncodedItem::ToolCall { content, .. } = &items[0] else {
        panic!("expected a tool call");
    };
    let ToolCallContent::Content {
        content: ContentBlock::Text { meta, .. },
    } = &content[0]
    else {
        panic!("expected a text content entry");
    };
    assert_eq!(meta, &None);
}
