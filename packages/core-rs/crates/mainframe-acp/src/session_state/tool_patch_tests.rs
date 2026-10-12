//! `tool_call_patch`'s one characterization test, moved out of
//! `session_state/tests.rs` — a status change through the full
//! `SessionState::diff` engine, landing here because it exercises this module's
//! own patch grammar specifically.

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

#[test]
fn tool_timing_completion_only_patch_matches_a_fresh_snapshot() {
    use crate::encoder::encode;
    use mainframe_types::display::DisplayMessage;
    use serde_json::json;

    let snapshot = |completed| {
        let mut timing = json!({"startedAt":1000});
        if completed {
            timing["completedAt"] = json!(1200);
        }
        let message: DisplayMessage = serde_json::from_value(json!({
            "id":"container","chatId":"c","type":"assistant","timestamp":"2026-10-02T00:00:00Z",
            "metadata":{"turnDurationMs":9000,"custom":"kept"},
            "content":[{"type":"task_group","agentId":"parent","taskArgs":{},"calls":[{
                "type":"tool_call","id":"a","name":"Read","input":{},"category":"explore","timing":timing}]}]
        })).unwrap();
        encode(&[message])
    };
    let running = snapshot(false);
    let completed = snapshot(true);
    let mut state = SessionState::new();
    state.diff(&running);
    let updates = state.diff(&completed);
    assert_eq!(updates.len(), 1);
    let SessionUpdate::ToolCallUpdate(patch) = &updates[0] else {
        panic!("expected tool patch");
    };
    assert_eq!(patch.tool_call_id, "a");
    assert_eq!(patch.status, None);
    assert_eq!(patch.content, None);
    assert_eq!(patch.title, None);
    assert_eq!(patch.raw_input, None);
    let mut applied = running;
    let EncodedItem::ToolCall { meta, .. } = &mut applied[1] else {
        panic!("expected tool");
    };
    *meta = patch.meta.clone().unwrap();
    assert_eq!(applied, completed);
    assert!(state.diff(&completed).is_empty());
    let meta = patch.meta.as_ref().unwrap().as_ref().unwrap();
    assert_eq!(meta["_mainframe.dev"]["parentToolCallId"], "parent");
    assert_eq!(meta["_mainframe.dev"]["containerId"], "parent");
    assert_eq!(
        meta["_mainframe.dev"]["toolCallTiming"],
        json!({"startedAt":1000,"completedAt":1200})
    );
}
