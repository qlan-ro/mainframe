use super::*;
use serde_json::json;

fn msg(id: &str, t: ChatMessageType, content: Vec<MessageContent>) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c".to_string(),
        r#type: t,
        content,
        timestamp: "t".to_string(),
        metadata: None,
    }
}

fn tool_use(id: &str) -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolUse {
        timing: None,
        command_execution: None,
        id: id.to_string(),
        name: "Bash".to_string(),
        input: HashMap::new(),
        parent_tool_use_id: None,
    })
}

fn tool_result(tool_use_id: &str) -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolResult {
        tool_use_id: tool_use_id.to_string(),
        content: "R".to_string(),
        is_error: false,
        structured_patch: None,
        original_file: None,
        modified_file: None,
        images: Vec::new(),
        parent_tool_use_id: None,
    })
}

#[test]
fn merges_consecutive_assistant_tool_use_turns() {
    let out = group_messages(vec![
        msg("a1", ChatMessageType::Assistant, vec![tool_use("tu_1")]),
        msg("a2", ChatMessageType::ToolUse, vec![tool_use("tu_2")]),
    ]);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].base.content.len(), 2);
}

#[test]
fn attaches_tool_results_to_preceding_turn() {
    let out = group_messages(vec![
        msg("a1", ChatMessageType::Assistant, vec![tool_use("tu_1")]),
        msg("r1", ChatMessageType::ToolResult, vec![tool_result("tu_1")]),
    ]);
    assert_eq!(out.len(), 1);
    assert!(out[0].tool_results.contains_key("tu_1"));
}

#[test]
fn dedupes_tool_use_by_id() {
    let out = group_messages(vec![msg(
        "a1",
        ChatMessageType::Assistant,
        vec![tool_use("tu_1"), tool_use("tu_1")],
    )]);
    assert_eq!(out[0].base.content.len(), 1);
}

#[test]
fn attaches_turn_duration_to_last_assistant_turn() {
    let mut sys = msg("s1", ChatMessageType::System, vec![]);
    let mut meta = HashMap::new();
    meta.insert("turnDurationMs".to_string(), json!(1234));
    sys.metadata = Some(meta);
    let out = group_messages(vec![
        msg("a1", ChatMessageType::Assistant, vec![tool_use("tu_1")]),
        sys,
    ]);
    assert_eq!(out.len(), 1);
    assert_eq!(
        out[0].base.metadata.as_ref().unwrap().get("turnDurationMs"),
        Some(&json!(1234))
    );
}
