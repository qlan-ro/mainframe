//! Marker cases — `Compaction`, `SkillLoaded`, and `Error` contributions that
//! carry no content of their own (`Accum::claim_marker`) or that do but must
//! still keep the container's ordering rule (`Error`, which stays on
//! `Accum::claim`) — split out of `segment_tests.rs`.

use mainframe_types::display::{DisplayContent, DisplayMessageType, DisplayNode, ToolCategory};

use super::segment_tests::pending_read;
use super::*;

fn compaction() -> DisplayContent {
    DisplayContent::Node(DisplayNode::Compaction {
        compaction: None,
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
                id: "message:0:top:dmsg_compact".to_string(),
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
                id: "message:0:top:dmsg_skill".to_string(),
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

    assert_eq!(
        encode(&messages),
        vec![
            EncodedItem::Message {
                id: "message:0:top:dmsg_err_seg".to_string(),
                role: ItemRole::Agent,
                content: vec![text_block("explaining ")],
                meta: Some(error_meta("dmsg_err_seg", None)),
            },
            EncodedItem::ToolCall {
                id: "tool:toolu_err".to_string(),
                title: "Read".to_string(),
                kind: ToolKind::Search,
                status: ToolCallStatus::InProgress,
                raw_input: json!({}),
                content: Vec::new(),
                meta: Some({
                    let mut meta = error_meta("dmsg_err_seg", None);
                    meta[MAINFRAME_META_NAMESPACE]["sourceToolCallId"] = json!("toolu_err");
                    meta
                }),
            },
            EncodedItem::Message {
                id: "message:1:top:dmsg_err_seg".to_string(),
                role: ItemRole::Agent,
                content: vec![text_block("boom")],
                meta: Some(error_meta("dmsg_err_seg", Some("boom"))),
            },
        ]
    );
}

#[test]
fn idle_compaction_is_a_separate_stable_non_actionable_item() {
    let request = mainframe_types::compaction::NativeCompactionRequest {
        id: "idle-compact:chat:run".into(),
        session_generation: "session".into(),
        origin: mainframe_types::compaction::CompactionOrigin::Idle,
        command_uuid: "command".into(),
    };
    let mut metadata = request.metadata(Some("boundary"));
    metadata.before_tokens = Some(22000);
    metadata.after_tokens = Some(2000);
    let messages = vec![dmsg(
        "assistant",
        DisplayMessageType::Assistant,
        vec![
            text("before"),
            DisplayContent::Node(DisplayNode::Compaction {
                compaction: Some(metadata),
                parent_tool_use_id: None,
            }),
            text("after"),
        ],
    )];
    let items = encode(&messages);
    assert_eq!(items.len(), 3);
    let EncodedItem::Message {
        id,
        meta: Some(meta),
        ..
    } = &items[1]
    else {
        panic!("idle message expected")
    };
    assert_eq!(id, "boundary");
    let ns = &meta[MAINFRAME_META_NAMESPACE];
    assert_eq!(ns["containerId"], "boundary");
    assert_eq!(ns["actionable"], false);
    assert_eq!(ns["compaction"]["origin"], "idle");
    assert_eq!(ns["compaction"]["beforeTokens"], 22000);
    let EncodedItem::Message {
        meta: Some(meta), ..
    } = &items[0]
    else {
        panic!("assistant expected")
    };
    assert!(meta[MAINFRAME_META_NAMESPACE].get("isCompacted").is_none());
    assert_eq!(encode(&messages), items);
}
