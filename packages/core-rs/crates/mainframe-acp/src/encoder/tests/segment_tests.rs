//! Text/thought segmentation cases — a run of message or thinking leaves
//! interrupted by a tool call (or the other leaf kind) closes and resumes as
//! a new segment item after the interruption, split out of `tests.rs`
//! (todo #350, plan task 37, R2.13). Marker cases (compaction, skill-loaded,
//! error) that ride the open segment instead of splitting it live in the
//! sibling `marker_tests.rs`.

use mainframe_types::display::{DisplayMessageType, ToolCategory};

use super::*;

/// An agent-role message item with one text block, at a literal id — never
/// derives `-{n}` here, or a bug in the real suffix logic would go unnoticed.
fn agent_text(id: &str, container: &str, s: &str) -> EncodedItem {
    EncodedItem::Message {
        id: id.to_string(),
        role: ItemRole::Agent,
        content: vec![text_block(s)],
        meta: Some(base_meta(container)),
    }
}

/// A pending (no-result) `Read` tool call, matching the shape asserted in
/// `tool_call_tests::encodes_a_tool_call_in_progress_and_completed`. Shared
/// with `marker_tests.rs`, which reuses this same fixture verbatim.
pub(super) fn pending_read(id: &str, container: &str) -> EncodedItem {
    EncodedItem::ToolCall {
        id: id.to_string(),
        title: "Read".to_string(),
        kind: ToolKind::Search,
        status: ToolCallStatus::InProgress,
        raw_input: json!({}),
        content: Vec::new(),
        meta: Some(base_meta(container)),
    }
}

#[test]
fn text_tool_text_tool_text_encodes_five_items_with_segmented_message_ids() {
    let messages = vec![dmsg(
        "dmsg_seg",
        DisplayMessageType::Assistant,
        vec![
            text("a"),
            tool_call("toolu_1", "Read", ToolCategory::Explore, None),
            text("b"),
            tool_call("toolu_2", "Read", ToolCategory::Explore, None),
            text("c"),
        ],
    )];

    assert_eq!(
        encode(&messages),
        vec![
            agent_text("dmsg_seg", "dmsg_seg", "a"),
            pending_read("toolu_1", "dmsg_seg"),
            agent_text("dmsg_seg-1", "dmsg_seg", "b"),
            pending_read("toolu_2", "dmsg_seg"),
            agent_text("dmsg_seg-2", "dmsg_seg", "c"),
        ]
    );
}

#[test]
fn text_separated_only_by_a_hidden_tool_call_coalesces_into_one_message() {
    let messages = vec![dmsg(
        "dmsg_hidden",
        DisplayMessageType::Assistant,
        vec![
            text("first "),
            tool_call("toolu_hidden", "TodoWrite", ToolCategory::Hidden, None),
            text("second"),
        ],
    )];

    // Hidden tool calls push no item, so the open segment is still the tail
    // of `out` when the next text leaf arrives — one message, no split.
    assert_eq!(
        encode(&messages),
        vec![agent_text("dmsg_hidden", "dmsg_hidden", "first second")]
    );
}

#[test]
fn text_thinking_text_segments_message_then_thought_then_message() {
    let messages = vec![dmsg(
        "dmsg_think",
        DisplayMessageType::Assistant,
        vec![text("a"), thinking("hmm"), text("b")],
    )];

    assert_eq!(
        encode(&messages),
        vec![
            agent_text("dmsg_think", "dmsg_think", "a"),
            EncodedItem::Thought {
                id: "dmsg_think-thought".to_string(),
                content: vec![text_block("hmm")],
                meta: Some(base_meta("dmsg_think")),
            },
            agent_text("dmsg_think-1", "dmsg_think", "b"),
        ]
    );
}

#[test]
fn thinking_text_thinking_segments_the_thought_accumulator_too() {
    let messages = vec![dmsg(
        "dmsg_think2",
        DisplayMessageType::Assistant,
        vec![thinking("first"), text("mid"), thinking("second")],
    )];

    // Case 3 above only proves the message accumulator segments; this proves
    // the thought accumulator's own `-{n}` suffix path independently.
    assert_eq!(
        encode(&messages),
        vec![
            EncodedItem::Thought {
                id: "dmsg_think2-thought".to_string(),
                content: vec![text_block("first")],
                meta: Some(base_meta("dmsg_think2")),
            },
            agent_text("dmsg_think2", "dmsg_think2", "mid"),
            EncodedItem::Thought {
                id: "dmsg_think2-thought-1".to_string(),
                content: vec![text_block("second")],
                meta: Some(base_meta("dmsg_think2")),
            },
        ]
    );
}

#[test]
fn text_then_tool_with_no_trailing_text_keeps_the_bare_container_id() {
    // Single-segment no-op case: only one text leaf ever claims the
    // accumulator, so it is never displaced from the tail and keeps the
    // unsuffixed container id, same as before segments existed.
    let messages = vec![dmsg(
        "dmsg_notrail",
        DisplayMessageType::Assistant,
        vec![
            text("Let me check."),
            tool_call("toolu_notrail", "Read", ToolCategory::Explore, None),
        ],
    )];

    assert_eq!(
        encode(&messages),
        vec![
            agent_text("dmsg_notrail", "dmsg_notrail", "Let me check."),
            pending_read("toolu_notrail", "dmsg_notrail"),
        ]
    );
}
