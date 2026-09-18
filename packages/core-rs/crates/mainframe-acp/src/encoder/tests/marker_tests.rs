//! Marker cases — `Compaction`, `SkillLoaded`, and `Error` contributions
//! that carry no content of their own (`Accum::claim_marker`) or that do
//! but must still keep the container's ordering rule (`Error`, which stays
//! on `Accum::claim`) — split out of `segment_tests.rs` (todo #350, plan
//! task 37, R2.13).

use mainframe_types::display::{DisplayContent, DisplayMessageType, DisplayNode, ToolCategory};

use super::segment_tests::pending_read;
use super::*;

fn compaction() -> DisplayContent {
    DisplayContent::Node(DisplayNode::Compaction {
        parent_tool_use_id: None,
    })
}

fn skill_loaded_leaf(skill_name: &str, path: &str, content: &str) -> DisplayContent {
    DisplayContent::Leaf(LeafContent::SkillLoaded {
        skill_name: skill_name.to_string(),
        path: path.to_string(),
        content: content.to_string(),
        parent_tool_use_id: None,
    })
}

fn error_node(message: &str) -> DisplayContent {
    DisplayContent::Node(DisplayNode::Error {
        message: message.to_string(),
    })
}

/// Base meta plus `isCompacted: true` — the marker a `Compaction` node rides
/// on whichever segment is already open (`Accum::claim_marker`).
fn compacted_meta(container: &str) -> Value {
    json!({ MAINFRAME_META_NAMESPACE: {
        "timestamp": "2026-08-28T00:00:00.000Z",
        "containerId": container,
        "isCompacted": true,
    }})
}

/// Base meta plus `skillLoaded` — the marker a `SkillLoaded` leaf rides on
/// whichever segment is already open (`Accum::claim_marker`).
fn skill_loaded_meta(container: &str, skill_name: &str, path: &str, content: &str) -> Value {
    json!({ MAINFRAME_META_NAMESPACE: {
        "timestamp": "2026-08-28T00:00:00.000Z",
        "containerId": container,
        "skillLoaded": { "skillName": skill_name, "path": path, "content": content },
    }})
}

/// Base meta plus `kind: "error"` and `errorText` — what an `Error` node
/// leaves on whichever segment is open when it lands (`Accum::claim`, which,
/// unlike the markers above, still splits).
fn error_meta(container: &str, error_text: Option<&str>) -> Value {
    let mut meta = json!({ MAINFRAME_META_NAMESPACE: {
        "timestamp": "2026-08-28T00:00:00.000Z",
        "containerId": container,
        "kind": "error",
    }});
    if let Some(text) = error_text {
        meta[MAINFRAME_META_NAMESPACE]["errorText"] = json!(text);
    }
    meta
}

#[test]
fn text_then_tool_then_compaction_rides_the_open_segment_with_no_empty_message() {
    let messages = vec![dmsg(
        "dmsg_compact",
        DisplayMessageType::Assistant,
        vec![
            text("done"),
            tool_call("toolu_compact", "Read", ToolCategory::Explore, None),
            compaction(),
        ],
    )];

    // `claim_marker` never splits: the compaction flag rides segment 0
    // (already open from the text leaf) instead of minting a third,
    // empty-content message item after the tool call.
    assert_eq!(
        encode(&messages),
        vec![
            EncodedItem::Message {
                id: "dmsg_compact".to_string(),
                role: ItemRole::Agent,
                content: vec![text_block("done")],
                meta: Some(compacted_meta("dmsg_compact")),
            },
            pending_read("toolu_compact", "dmsg_compact"),
        ]
    );
}

#[test]
fn text_then_tool_then_skill_loaded_rides_the_open_segment_with_no_empty_message() {
    let messages = vec![dmsg(
        "dmsg_skill",
        DisplayMessageType::Assistant,
        vec![
            text("done"),
            tool_call("toolu_skill", "Read", ToolCategory::Explore, None),
            skill_loaded_leaf("tdd", "/skills/tdd", "always red first"),
        ],
    )];

    assert_eq!(
        encode(&messages),
        vec![
            EncodedItem::Message {
                id: "dmsg_skill".to_string(),
                role: ItemRole::Agent,
                content: vec![text_block("done")],
                meta: Some(skill_loaded_meta(
                    "dmsg_skill",
                    "tdd",
                    "/skills/tdd",
                    "always red first"
                )),
            },
            pending_read("toolu_skill", "dmsg_skill"),
        ]
    );
}

#[test]
fn text_then_tool_then_error_segments_and_carries_error_text_on_the_later_segment() {
    let messages = vec![dmsg(
        "dmsg_err_seg",
        DisplayMessageType::Error,
        vec![
            text("explaining "),
            tool_call("toolu_err", "Read", ToolCategory::Explore, None),
            error_node("boom"),
        ],
    )];

    // `Error` still uses `claim` (it pushes real text), so it segments like
    // any other text contribution: closing segment 0 without an error
    // marker and landing `errorText` on the freshly opened `-1` segment.
    // This shape is unreachable through the live display pipeline today —
    // `ChatMessageType::Error` containers only ever produce `Error` nodes or
    // empty text (display_pipeline.rs), never a tool call — so this pins
    // real encoder behaviour on an input the adapter can't currently emit,
    // not a live bug. The client no longer assumes segment 0 either way:
    // `errorContainer` (convert-acp-item.ts) scans every message segment in
    // the container for `errorText`, so a later-segment marker still renders.
    assert_eq!(
        encode(&messages),
        vec![
            EncodedItem::Message {
                id: "dmsg_err_seg".to_string(),
                role: ItemRole::Agent,
                content: vec![text_block("explaining ")],
                meta: Some(error_meta("dmsg_err_seg", None)),
            },
            EncodedItem::ToolCall {
                id: "toolu_err".to_string(),
                title: "Read".to_string(),
                kind: ToolKind::Search,
                status: ToolCallStatus::InProgress,
                raw_input: json!({}),
                content: Vec::new(),
                meta: Some(error_meta("dmsg_err_seg", None)),
            },
            EncodedItem::Message {
                id: "dmsg_err_seg-1".to_string(),
                role: ItemRole::Agent,
                content: vec![text_block("boom")],
                meta: Some(error_meta("dmsg_err_seg", Some("boom"))),
            },
        ]
    );
}
