#![allow(clippy::unwrap_used, clippy::expect_used)]
use mainframe_adapter_claude::messages::display_helpers::{
    apply_tool_grouping, convert_assistant_content,
};
use mainframe_adapter_claude::messages::message_grouping::GroupedMessage;
use mainframe_types::chat::{ChatMessage, ChatMessageType};
use mainframe_types::display::{DisplayContent, DisplayNode, ToolCategories};
use serde_json::{Value, json};
use std::collections::HashMap;

fn metadata() -> Value {
    json!({"commandActions":[{"type":"unknown","command":"run"}],"reportedDurationMs":0})
}
fn call(id: &str, parent: Option<&str>, with_metadata: bool) -> Value {
    let mut value = json!({"type":"tool_use","id":id,"name":"Bash","input":{"command":"run"}});
    if let Some(parent) = parent {
        value["parentToolUseId"] = json!(parent);
    }
    if with_metadata {
        value["commandExecution"] = metadata();
    }
    value
}
fn grouped(blocks: Vec<Value>) -> GroupedMessage {
    GroupedMessage {
        base: ChatMessage {
            id: "m".into(),
            chat_id: "c".into(),
            r#type: ChatMessageType::Assistant,
            content: blocks
                .into_iter()
                .map(|v| serde_json::from_value(v).unwrap())
                .collect(),
            timestamp: "now".into(),
            metadata: None,
        },
        tool_results: HashMap::new(),
    }
}
fn collect(blocks: &[DisplayContent]) -> Vec<Value> {
    blocks
        .iter()
        .flat_map(|b| match b {
            DisplayContent::Node(
                DisplayNode::ToolGroup { calls } | DisplayNode::TaskGroup { calls, .. },
            ) => collect(calls),
            _ => vec![serde_json::to_value(b).unwrap()],
        })
        .collect()
}
#[test]
fn command_metadata_survives_regular_grouped_and_nested_calls_without_leaking_to_neighbors() {
    for nested in [false, true] {
        let mut blocks = vec![];
        if nested {
            blocks.push(
                json!({"type":"tool_use","id":"task","name":"Task","input":{"description":"test"}}),
            );
        }
        blocks.push(call("cmd", nested.then_some("task"), true));
        blocks.push(call("neighbor", nested.then_some("task"), false));
        let categories: ToolCategories = serde_json::from_value(
            json!({"explore":["Bash"],"hidden":[],"progress":[],"subagent":["Task"]}),
        )
        .unwrap();
        let display = convert_assistant_content(&grouped(blocks), Some(&categories));
        let plain = collect(&display);
        assert_eq!(
            plain.iter().find(|v| v["id"] == "cmd").unwrap()["commandExecution"],
            metadata()
        );
        let grouped = collect(&apply_tool_grouping(display, &categories));
        assert_eq!(
            grouped.iter().find(|v| v["id"] == "cmd").unwrap()["commandExecution"],
            metadata()
        );
        assert!(
            grouped
                .iter()
                .find(|v| v["id"] == "neighbor")
                .unwrap()
                .get("commandExecution")
                .is_none()
        );
    }
}
