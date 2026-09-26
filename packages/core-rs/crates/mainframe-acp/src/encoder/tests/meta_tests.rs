//! Container/item meta cases — system/error markers, per-item display
//! metadata, and the ask-user-question result shape — split out of
//! `tests.rs` (todo #350, plan task 37, R2.13).

use std::collections::HashMap;

use mainframe_types::display::{
    DisplayContent, DisplayMessageType, DisplayNode, ToolCallResult, ToolCategory,
};

use super::*;
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
fn an_attachment_only_user_container_still_encodes_a_message_item() {
    let mut message = dmsg("dmsg_att", DisplayMessageType::User, vec![]);
    message.metadata = Some(HashMap::from([(
        "attachments".to_string(),
        json!([{ "name": "notes.txt", "kind": "file" }]),
    )]));

    let items = encode(&[message]);
    assert_eq!(items.len(), 1);
    let EncodedItem::Message {
        id,
        role,
        content,
        meta,
    } = &items[0]
    else {
        panic!("expected a message item");
    };
    assert_eq!(id, "dmsg_att");
    assert_eq!(*role, ItemRole::User);
    assert!(content.is_empty());
    let ns = &meta.as_ref().unwrap()[MAINFRAME_META_NAMESPACE];
    assert_eq!(
        ns["messageMeta"]["attachments"][0]["name"],
        json!("notes.txt")
    );
}

#[test]
fn a_replay_user_container_with_attached_files_still_encodes_a_message_item() {
    let mut message = dmsg("dmsg_replay", DisplayMessageType::User, vec![]);
    message.metadata = Some(HashMap::from([(
        "attachedFiles".to_string(),
        json!([{ "name": "notes.txt" }]),
    )]));

    let items = encode(&[message]);
    assert_eq!(items.len(), 1);
    let EncodedItem::Message { content, meta, .. } = &items[0] else {
        panic!("expected a message item");
    };
    assert!(content.is_empty());
    let ns = &meta.as_ref().unwrap()[MAINFRAME_META_NAMESPACE];
    assert_eq!(
        ns["messageMeta"]["attachedFiles"][0]["name"],
        json!("notes.txt")
    );
}

#[test]
fn an_empty_user_container_with_no_attachment_evidence_encodes_no_item() {
    let message = dmsg("dmsg_empty", DisplayMessageType::User, vec![]);

    let items = encode(&[message]);
    assert!(items.is_empty());
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
                images: Vec::new(),
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
