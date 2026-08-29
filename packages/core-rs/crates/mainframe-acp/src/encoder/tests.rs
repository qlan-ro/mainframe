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

fn image(data: &str, media_type: &str) -> DisplayContent {
    DisplayContent::Leaf(LeafContent::Image {
        media_type: media_type.to_string(),
        data: data.to_string(),
        parent_tool_use_id: None,
    })
}

/// The uniform per-item meta every encoder item now carries (desktop-cutover
/// pass): timestamp + container id under the namespace, plus any extras.
fn base_meta(container: &str) -> Value {
    json!({ MAINFRAME_META_NAMESPACE: {
        "timestamp": "2026-08-28T00:00:00.000Z",
        "containerId": container,
    }})
}

fn meta_with(container: &str, extras: &[(&str, Value)]) -> Value {
    let mut v = base_meta(container);
    let ns = v[MAINFRAME_META_NAMESPACE].as_object_mut().unwrap();
    for (k, val) in extras {
        ns.insert((*k).to_string(), val.clone());
    }
    v
}

fn text_block(s: &str) -> ContentBlock {
    ContentBlock::Text {
        text: s.to_string(),
        meta: None,
    }
}

fn image_block(data: &str, mime_type: &str) -> ContentBlock {
    ContentBlock::Image {
        data: data.to_string(),
        mime_type: mime_type.to_string(),
        uri: None,
        meta: None,
    }
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
            content: vec![text_block("hi")],
            meta: Some(base_meta("dmsg_1")),
        }]
    );
}

#[test]
fn interleaved_text_and_image_leaves_encode_as_an_ordered_block_list() {
    let messages = vec![dmsg(
        "dmsg_img",
        DisplayMessageType::User,
        vec![
            text("What does "),
            text("this show?"),
            image("iVBORw0KGgo=", "image/png"),
            text("Thanks."),
        ],
    )];
    let items = encode(&messages);

    // Adjacent text leaves coalesce into one block (the no-adjacent-text-
    // blocks invariant); the image sits between text blocks in leaf order.
    assert_eq!(
        items,
        vec![EncodedItem::Message {
            id: "dmsg_img".to_string(),
            role: ItemRole::User,
            content: vec![
                text_block("What does this show?"),
                image_block("iVBORw0KGgo=", "image/png"),
                text_block("Thanks."),
            ],
            meta: Some(base_meta("dmsg_img")),
        }]
    );
}

#[test]
fn an_image_only_message_encodes_a_single_image_block() {
    let messages = vec![dmsg(
        "dmsg_img2",
        DisplayMessageType::User,
        vec![image("aGk=", "image/jpeg")],
    )];
    assert_eq!(
        encode(&messages),
        vec![EncodedItem::Message {
            id: "dmsg_img2".to_string(),
            role: ItemRole::User,
            content: vec![image_block("aGk=", "image/jpeg")],
            meta: Some(base_meta("dmsg_img2")),
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

    // First-contribution ordering: the thinking leaf precedes the text leaf,
    // so the thought item sits before the message item.
    assert_eq!(
        items,
        vec![
            EncodedItem::Thought {
                id: "dmsg_2-thought".to_string(),
                content: vec![text_block("hmm")],
                meta: Some(base_meta("dmsg_2")),
            },
            EncodedItem::Message {
                id: "dmsg_2".to_string(),
                role: ItemRole::Agent,
                content: vec![text_block("done")],
                meta: Some(base_meta("dmsg_2")),
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
            meta: Some(base_meta("dmsg_5")),
        }]
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

#[test]
fn a_text_leaf_before_a_tool_call_keeps_its_position() {
    let items = encode(&[dmsg(
        "dmsg_ord",
        DisplayMessageType::Assistant,
        vec![
            text("Let me read the file."),
            tool_call("toolu_ord", "Read", ToolCategory::Explore, None),
        ],
    )]);

    assert_eq!(items.len(), 2);
    assert!(matches!(&items[0], EncodedItem::Message { .. }));
    assert_eq!(items[1].id(), "toolu_ord");
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

#[test]
fn a_system_message_carries_skill_and_compaction_markers_in_meta() {
    let items = encode(&[dmsg(
        "dmsg_sys",
        DisplayMessageType::System,
        vec![
            DisplayContent::Leaf(LeafContent::SkillLoaded {
                skill_name: "tdd".to_string(),
                path: "/skills/tdd".to_string(),
                content: "always red first".to_string(),
                parent_tool_use_id: None,
            }),
            DisplayContent::Node(DisplayNode::Compaction {
                parent_tool_use_id: None,
            }),
        ],
    )]);

    assert_eq!(items.len(), 1);
    let EncodedItem::Message { content, meta, .. } = &items[0] else {
        panic!("expected a message item");
    };
    // Markers ride meta, not bracket-text placeholders.
    assert!(content.is_empty());
    let ns = &meta.as_ref().unwrap()[MAINFRAME_META_NAMESPACE];
    assert_eq!(ns["kind"], json!("system"));
    assert_eq!(ns["isCompacted"], json!(true));
    assert_eq!(
        ns["skillLoaded"],
        json!({ "skillName": "tdd", "path": "/skills/tdd", "content": "always red first" })
    );
}

#[test]
fn an_error_message_carries_error_text_in_meta_and_as_a_text_block() {
    let items = encode(&[dmsg(
        "dmsg_err",
        DisplayMessageType::Error,
        vec![DisplayContent::Node(DisplayNode::Error {
            message: "CLI died".to_string(),
        })],
    )]);

    let EncodedItem::Message { content, meta, .. } = &items[0] else {
        panic!("expected a message item");
    };
    assert_eq!(content, &vec![text_block("CLI died")]);
    let ns = &meta.as_ref().unwrap()[MAINFRAME_META_NAMESPACE];
    assert_eq!(ns["kind"], json!("error"));
    assert_eq!(ns["errorText"], json!("CLI died"));
}

#[test]
fn display_metadata_rides_every_item_of_the_container() {
    let mut metadata = HashMap::new();
    metadata.insert("cost_usd".to_string(), json!(0.42));
    let mut message = dmsg(
        "dmsg_meta",
        DisplayMessageType::Assistant,
        vec![
            text("done"),
            tool_call("toolu_m1", "Read", ToolCategory::Explore, Some("x")),
        ],
    );
    message.metadata = Some(metadata);

    let items = encode(&[message]);
    assert_eq!(items.len(), 2);
    for item in &items {
        let meta = match item {
            EncodedItem::Message { meta, .. }
            | EncodedItem::Thought { meta, .. }
            | EncodedItem::ToolCall { meta, .. } => meta,
        };
        assert_eq!(
            meta.as_ref().unwrap()[MAINFRAME_META_NAMESPACE]["messageMeta"]["cost_usd"],
            json!(0.42)
        );
    }
}

#[test]
fn an_ask_user_question_result_carries_its_answers_in_the_text_block_meta() {
    let messages = vec![dmsg(
        "dmsg_ask",
        DisplayMessageType::Assistant,
        vec![DisplayContent::Node(DisplayNode::ToolCall {
            id: "toolu_ask".to_string(),
            name: "AskUserQuestion".to_string(),
            input: HashMap::new(),
            category: ToolCategory::Default,
            result: Some(ToolCallResult {
                content: "answered".to_string(),
                is_error: false,
                structured_patch: None,
                original_file: None,
                modified_file: None,
                truncated: None,
                full_bytes: None,
                ask_user_question: Some(vec![mainframe_types::display::AskUserQuestionAnswer {
                    question: "Which db?".to_string(),
                    answer: vec!["sqlite".to_string()],
                    preview: None,
                    notes: None,
                }]),
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
        meta.as_ref().unwrap()[MAINFRAME_META_NAMESPACE]["askUserQuestion"][0]["question"],
        json!("Which db?")
    );
}
