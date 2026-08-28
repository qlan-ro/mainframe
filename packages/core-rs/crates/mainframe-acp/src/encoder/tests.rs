use std::collections::HashMap;

use mainframe_types::display::{
    DisplayContent, DisplayMessage, DisplayMessageType, DisplayNode, TaskProgressItem,
    ToolCallResult, ToolCategory,
};

use super::*;

fn dmsg(id: &str, r#type: DisplayMessageType, content: Vec<DisplayContent>) -> DisplayMessage {
    DisplayMessage {
        id: id.to_string(),
        chat_id: "chat_1".to_string(),
        r#type,
        content,
        timestamp: "2026-08-28T00:00:00.000Z".to_string(),
        metadata: None,
    }
}

fn text(s: &str) -> DisplayContent {
    DisplayContent::Leaf(LeafContent::Text {
        text: s.to_string(),
        parent_tool_use_id: None,
    })
}

fn thinking(s: &str) -> DisplayContent {
    DisplayContent::Leaf(LeafContent::Thinking {
        thinking: s.to_string(),
        parent_tool_use_id: None,
    })
}

fn tool_call(id: &str, name: &str, category: ToolCategory, result: Option<&str>) -> DisplayContent {
    DisplayContent::Node(DisplayNode::ToolCall {
        id: id.to_string(),
        name: name.to_string(),
        input: HashMap::new(),
        category,
        result: result.map(|content| ToolCallResult {
            content: content.to_string(),
            is_error: false,
            structured_patch: None,
            original_file: None,
            modified_file: None,
            truncated: None,
            full_bytes: None,
            ask_user_question: None,
        }),
        parent_tool_use_id: None,
    })
}

#[test]
fn encodes_a_user_text_message() {
    let messages = vec![dmsg("dmsg_1", DisplayMessageType::User, vec![text("hi")])];
    let items = encode(&messages);

    assert_eq!(
        items,
        vec![EncodedItem::Message {
            id: "dmsg_1".to_string(),
            role: ItemRole::User,
            text: "hi".to_string(),
            meta: None,
        }]
    );
}

#[test]
fn encodes_an_assistant_thinking_block_as_a_separate_thought_item() {
    let messages = vec![dmsg(
        "dmsg_2",
        DisplayMessageType::Assistant,
        vec![thinking("hmm"), text("done")],
    )];
    let items = encode(&messages);

    assert_eq!(
        items,
        vec![
            EncodedItem::Message {
                id: "dmsg_2".to_string(),
                role: ItemRole::Agent,
                text: "done".to_string(),
                meta: None,
            },
            EncodedItem::Thought {
                id: "dmsg_2-thought".to_string(),
                text: "hmm".to_string(),
                meta: None,
            },
        ]
    );
}

#[test]
fn encodes_a_tool_call_in_progress_and_completed() {
    let pending = vec![dmsg(
        "dmsg_3",
        DisplayMessageType::Assistant,
        vec![tool_call("toolu_1", "Read", ToolCategory::Explore, None)],
    )];
    let items = encode(&pending);
    assert_eq!(
        items,
        vec![EncodedItem::ToolCall {
            id: "toolu_1".to_string(),
            title: "Read".to_string(),
            kind: ToolKind::Search,
            status: ToolCallStatus::InProgress,
            raw_input: json!({}),
            content: Vec::new(),
            meta: None,
        }]
    );

    let completed = vec![dmsg(
        "dmsg_3",
        DisplayMessageType::Assistant,
        vec![tool_call(
            "toolu_1",
            "Read",
            ToolCategory::Explore,
            Some("package contents"),
        )],
    )];
    let items = encode(&completed);
    assert_eq!(
        items,
        vec![EncodedItem::ToolCall {
            id: "toolu_1".to_string(),
            title: "Read".to_string(),
            kind: ToolKind::Search,
            status: ToolCallStatus::Completed,
            raw_input: json!({}),
            content: vec![ToolCallContent::Content {
                content: ContentBlock::Text {
                    text: "package contents".to_string(),
                }
            }],
            meta: None,
        }]
    );
}

#[test]
fn flattens_a_subagent_task_group_to_tool_call_items_with_a_parent_relation() {
    let mut task_args = HashMap::new();
    task_args.insert(
        "description".to_string(),
        Value::String("Investigate flake".to_string()),
    );
    let messages = vec![dmsg(
        "dmsg_4",
        DisplayMessageType::Assistant,
        vec![DisplayContent::Node(DisplayNode::TaskGroup {
            agent_id: "toolu_task_1".to_string(),
            task_args,
            calls: vec![
                text("Looking into it."),
                tool_call(
                    "toolu_sub_1",
                    "Grep",
                    ToolCategory::Explore,
                    Some("3 matches"),
                ),
            ],
            result: None,
        })],
    )];

    let items = encode(&messages);

    // No `task_group`/nesting item: only flattened tool-call items.
    assert_eq!(items.len(), 3);

    let parent = &items[0];
    assert_eq!(parent.id(), "toolu_task_1");
    assert!(
        matches!(parent, EncodedItem::ToolCall { kind: ToolKind::Think, title, .. } if title == "Investigate flake")
    );

    let subagent_text = items
        .iter()
        .find(|i| matches!(i, EncodedItem::Message { .. }))
        .expect("subagent text item");
    let EncodedItem::Message { meta, .. } = subagent_text else {
        unreachable!()
    };
    assert_eq!(
        meta.as_ref().unwrap()["_mainframe.dev"]["parentToolCallId"],
        json!("toolu_task_1")
    );

    let sub_tool = items
        .iter()
        .find(|i| i.id() == "toolu_sub_1")
        .expect("subagent tool-call item");
    let EncodedItem::ToolCall { meta, .. } = sub_tool else {
        unreachable!()
    };
    assert_eq!(
        meta.as_ref().unwrap()["_mainframe.dev"]["parentToolCallId"],
        json!("toolu_task_1")
    );
}

#[test]
fn an_edit_result_with_structured_hunks_encodes_a_diff_content_entry() {
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
    assert_eq!(
        serde_json::to_value(&diff.changes).unwrap(),
        json!([{ "operation": "modify", "path": "/w/src/config.json", "fileType": "text" }])
    );
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
fn flattens_task_progress_items_to_tool_call_items() {
    let messages = vec![dmsg(
        "dmsg_5",
        DisplayMessageType::Assistant,
        vec![DisplayContent::Node(DisplayNode::TaskProgress {
            items: vec![TaskProgressItem {
                id: "toolu_bg_1".to_string(),
                name: "Bash".to_string(),
                input: HashMap::new(),
                category: ToolCategory::Progress,
                result: None,
            }],
        })],
    )];

    let items = encode(&messages);

    assert_eq!(
        items,
        vec![EncodedItem::ToolCall {
            id: "toolu_bg_1".to_string(),
            title: "Bash".to_string(),
            kind: ToolKind::Execute,
            status: ToolCallStatus::InProgress,
            raw_input: json!({}),
            content: Vec::new(),
            meta: None,
        }]
    );
}

#[test]
fn is_pure_same_input_produces_the_same_output() {
    let messages = vec![
        dmsg("dmsg_1", DisplayMessageType::User, vec![text("hi")]),
        dmsg(
            "dmsg_2",
            DisplayMessageType::Assistant,
            vec![tool_call(
                "toolu_1",
                "Read",
                ToolCategory::Explore,
                Some("x"),
            )],
        ),
    ];

    assert_eq!(encode(&messages), encode(&messages));
}

/// Criterion 10/plan task 12: live streaming and history replay both produce
/// `DisplayMessage[]` (group B made their ids agree) — the encoder over that
/// shared type must yield identical items for identical input regardless of
/// which pipeline produced it.
#[test]
fn live_and_history_snapshots_with_matching_ids_encode_identically() {
    let live = vec![dmsg(
        "shared-id-1",
        DisplayMessageType::Assistant,
        vec![
            text("done"),
            tool_call("toolu_1", "Read", ToolCategory::Explore, Some("x")),
        ],
    )];
    let history = vec![dmsg(
        "shared-id-1",
        DisplayMessageType::Assistant,
        vec![
            text("done"),
            tool_call("toolu_1", "Read", ToolCategory::Explore, Some("x")),
        ],
    )];

    assert_eq!(encode(&live), encode(&history));
}
