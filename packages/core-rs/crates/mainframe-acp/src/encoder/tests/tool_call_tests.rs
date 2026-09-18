//! Tool-call / tool-group / task-group / task-progress encoding cases,
//! split out of `tests.rs` (todo #350, plan task 37, R2.13).

use std::collections::HashMap;

use mainframe_types::display::{
    DisplayContent, DisplayMessageType, DisplayNode, TaskProgressItem, ToolCategory,
};

use super::*;
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
            meta: Some(base_meta("dmsg_3")),
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
                    meta: None,
                }
            }],
            meta: Some(base_meta("dmsg_3")),
        }]
    );
}

/// Shared fixture for the `flattens_a_subagent_task_group_*` tests below —
/// one `TaskGroup` with a child text leaf and a child tool call, split into
/// three tests (one per asserted item) rather than one 67-line function.
fn flattened_task_group_items() -> Vec<EncodedItem> {
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
    encode(&messages)
}

#[test]
fn a_flattened_task_group_produces_no_nesting_item_only_tool_calls() {
    // No `task_group`/nesting item: only flattened tool-call items.
    assert_eq!(flattened_task_group_items().len(), 3);
}

#[test]
fn the_flattened_parent_tool_call_carries_the_subagent_marker() {
    let items = flattened_task_group_items();
    let parent = &items[0];
    assert_eq!(parent.id(), "toolu_task_1");
    assert!(
        matches!(parent, EncodedItem::ToolCall { kind: ToolKind::Think, title, .. } if title == "Investigate flake")
    );

    let EncodedItem::ToolCall {
        meta: task_meta, ..
    } = parent
    else {
        unreachable!()
    };
    assert_eq!(
        task_meta.as_ref().unwrap()[MAINFRAME_META_NAMESPACE]["subagent"],
        json!(true)
    );
}

#[test]
fn the_flattened_subagent_message_and_tool_call_carry_the_parent_relation() {
    let items = flattened_task_group_items();

    let subagent_text = items
        .iter()
        .find(|i| matches!(i, EncodedItem::Message { .. }))
        .expect("subagent text item");
    // Suffixed: an unsuffixed child message item would collide with (and
    // clobber) the Task tool-call item in any id-keyed accumulator.
    assert_eq!(subagent_text.id(), "toolu_task_1-message");
    let EncodedItem::Message { meta, .. } = subagent_text else {
        unreachable!()
    };
    assert_eq!(
        meta.as_ref().unwrap()["_mainframe.dev"]["parentToolCallId"],
        json!("toolu_task_1")
    );
    assert_eq!(
        meta.as_ref().unwrap()["_mainframe.dev"]["containerId"],
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

/// Shared fixture for the `an_edit_result_*` tests below — one `Edit` tool
/// call with a structured-patch result, split into three tests (one per
/// asserted aspect of the diff content entry) rather than one 61-line
/// function.
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
            meta: Some(base_meta("dmsg_5")),
        }]
    );
}

#[test]
fn hidden_category_tool_calls_are_not_encoded() {
    let items = encode(&[dmsg(
        "dmsg_hidden",
        DisplayMessageType::Assistant,
        vec![
            tool_call(
                "toolu_hidden",
                "TodoWrite",
                ToolCategory::Hidden,
                Some("ok"),
            ),
            tool_call("toolu_shown", "Read", ToolCategory::Explore, None),
        ],
    )]);

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id(), "toolu_shown");
}

#[test]
fn tool_group_members_share_the_first_visible_member_id_as_group_id() {
    let items = encode(&[dmsg(
        "dmsg_grp",
        DisplayMessageType::Assistant,
        vec![DisplayContent::Node(DisplayNode::ToolGroup {
            calls: vec![
                tool_call("toolu_g1", "Read", ToolCategory::Explore, Some("a")),
                tool_call("toolu_g2", "Grep", ToolCategory::Explore, Some("b")),
            ],
        })],
    )]);

    assert_eq!(items.len(), 2);
    for item in &items {
        let EncodedItem::ToolCall { meta, .. } = item else {
            panic!("expected tool-call items");
        };
        assert_eq!(
            meta.as_ref().unwrap()[MAINFRAME_META_NAMESPACE]["groupId"],
            json!("toolu_g1")
        );
    }
}
