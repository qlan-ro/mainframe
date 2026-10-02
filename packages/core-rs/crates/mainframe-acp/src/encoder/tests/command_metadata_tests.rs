use super::*;
use crate::session_state::SessionState;
use mainframe_types::acp::update::SessionUpdate;

fn snapshot(duration: Option<i64>) -> Vec<EncodedItem> {
    let mut command = json!({"type":"tool_call","id":"cmd","name":"Bash","input":{"command":"cat a"},
        "category":"explore","commandExecution":{"commandActions":[{"type":"read","command":"cat a","name":"a","path":"a"}]}});
    if let Some(duration) = duration {
        command["commandExecution"]["reportedDurationMs"] = json!(duration);
    }
    let call = serde_json::from_value(command).unwrap();
    let grouped = DisplayContent::Node(DisplayNode::ToolGroup { calls: vec![call] });
    let task = DisplayContent::Node(DisplayNode::TaskGroup {
        timing: None,
        agent_id: "parent".into(),
        task_args: HashMap::new(),
        calls: vec![grouped],
        result: None,
    });
    encode(&[dmsg("m", DisplayMessageType::Assistant, vec![task])])
}

#[test]
fn command_metadata_duration_patch_keeps_actions_group_container_and_parent() {
    let mut state = SessionState::new();
    state.diff(&snapshot(None));
    for duration in [0, 1234] {
        let updates = state.diff(&snapshot(Some(duration)));
        assert_eq!(updates.len(), 1);
        let SessionUpdate::ToolCallUpdate(patch) = &updates[0] else {
            panic!("tool patch")
        };
        let value = serde_json::to_value(patch).unwrap();
        assert_eq!(value["toolCallId"], "cmd");
        assert_eq!(
            value["_meta"]["_mainframe.dev"],
            json!({
                "timestamp":"2026-08-28T00:00:00.000Z", "containerId":"parent", "parentToolCallId":"parent", "groupId":"cmd",
                "commandExecution":{"commandActions":[{"type":"read","command":"cat a","name":"a","path":"a"}],"reportedDurationMs":duration}
            })
        );
        assert!(value.get("rawInput").is_none());
        assert!(value.get("status").is_none());
    }
}
