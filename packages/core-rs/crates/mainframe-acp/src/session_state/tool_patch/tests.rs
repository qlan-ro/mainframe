//! `tool_call_patch`'s one characterization test, moved out of
//! `session_state/tests.rs` (todo #350, plan task 37, R2.13) — a status
//! change through the full `SessionState::diff` engine, landing here
//! because it exercises this module's own patch grammar specifically.

use super::super::*;
use crate::encoder::EncodedItem;
use mainframe_types::acp::tool_call::{ToolCallContent, ToolCallStatus, ToolKind};

fn tool(id: &str, status: ToolCallStatus, content: Vec<ToolCallContent>) -> EncodedItem {
    EncodedItem::ToolCall {
        id: id.to_string(),
        title: "Read".to_string(),
        kind: ToolKind::Read,
        status,
        raw_input: Value::Null,
        content,
        meta: None,
    }
}

#[test]
fn a_tool_call_status_change_patches_only_the_changed_field() {
    let mut state = SessionState::new();
    state.diff(&[tool("t1", ToolCallStatus::InProgress, Vec::new())]);

    let updates = state.diff(&[tool(
        "t1",
        ToolCallStatus::Completed,
        vec![ToolCallContent::Content {
            content: ContentBlock::Text {
                text: "done".to_string(),
                meta: None,
            },
        }],
    )]);

    assert_eq!(updates.len(), 1);
    let SessionUpdate::ToolCallUpdate(patch) = &updates[0] else {
        panic!("expected ToolCallUpdate");
    };
    assert_eq!(patch.tool_call_id, "t1");
    assert_eq!(patch.status, Some(Some(ToolCallStatus::Completed)));
    assert!(patch.content.is_some());
    // Unchanged fields stay omitted (patch grammar): title/kind/raw_input
    // never differed between the two snapshots.
    assert_eq!(patch.title, None);
    assert_eq!(patch.kind, None);
    assert_eq!(patch.raw_input, None);
}
