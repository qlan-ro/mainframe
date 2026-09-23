//! Basic leaf/content ordering, purity/parity, and queued-turn cases
//! for the canonical encoder. Tool-call/task-group cases moved to
//! `tool_call_tests.rs`, diff/truncation cases to
//! `result_content_tests.rs`, container/meta cases to `meta_tests.rs`,
//! text/thought segmentation cases to `segment_tests.rs`, and
//! no-split marker cases (compaction, skill-loaded, error) to
//! `marker_tests.rs` (todo #350, plan task 37, R2.13) — all five share
//! this file's fixture builders via `use super::*`.

mod marker_tests;
mod meta_tests;
mod result_content_tests;
mod segment_tests;
mod tool_call_tests;

use std::collections::HashMap;

use mainframe_types::display::{
    DisplayContent, DisplayMessageType, DisplayNode, ToolCallResult, ToolCategory,
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
            images: Vec::new(),
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
fn queued_messages_are_not_encoded_as_items() {
    let mut queued = dmsg("q1", DisplayMessageType::User, vec![text("queued turn")]);
    queued.metadata = Some(HashMap::from([("queued".to_string(), json!(true))]));
    let messages = vec![
        dmsg("u1", DisplayMessageType::User, vec![text("hi")]),
        queued,
        dmsg("a1", DisplayMessageType::Assistant, vec![text("hello")]),
    ];

    let items = encode(&messages);
    let ids: Vec<&str> = items.iter().map(EncodedItem::id).collect();
    assert_eq!(ids, vec!["u1", "a1"]);
}
