use super::*;
use serde_json::json;

fn tool_use(id: &str, name: &str, parent: Option<&str>) -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolUse {
        timing: None,
        command_execution: None,
        id: id.to_string(),
        name: name.to_string(),
        input: HashMap::new(),
        parent_tool_use_id: parent.map(str::to_string),
    })
}

fn assistant(content: Vec<MessageContent>) -> ChatMessage {
    ChatMessage {
        id: "m".to_string(),
        chat_id: "c".to_string(),
        r#type: ChatMessageType::Assistant,
        content,
        timestamp: "t".to_string(),
        metadata: None,
    }
}

#[test]
fn append_assistant_blocks_tags_parent_and_skips_empty() {
    let mut tools: HashMap<String, Vec<MessageContent>> = HashMap::new();
    let content = vec![
        json!({ "type": "text", "text": "   " }),
        json!({ "type": "text", "text": "hi" }),
        json!({ "type": "tool_use", "id": "tu_1", "name": "Grep", "input": {} }),
    ];
    append_assistant_blocks("parent-1", &content, &mut tools);
    let blocks = tools.get("parent-1").unwrap();
    assert_eq!(blocks.len(), 2); // whitespace-only text dropped
    assert!(matches!(
        &blocks[0],
        MessageContent::Leaf(LeafContent::Text { parent_tool_use_id: Some(p), .. }) if p == "parent-1"
    ));
}

#[test]
fn inject_agent_children_places_children_after_agent_tool_use() {
    let mut tools: HashMap<String, Vec<MessageContent>> = HashMap::new();
    tools.insert(
        "agent-tu".to_string(),
        vec![tool_use("child", "Bash", Some("agent-tu"))],
    );
    let mut messages = vec![assistant(vec![tool_use("agent-tu", "Task", None)])];
    inject_agent_children(&mut messages, &tools);
    assert_eq!(messages[0].content.len(), 2);
    assert!(matches!(
        &messages[0].content[1],
        MessageContent::Node(MessageContentNode::ToolUse { id, .. }) if id == "child"
    ));
}

#[test]
fn attach_subagent_tool_results_appends_after_tool_use_with_parent() {
    let mut results: HashMap<String, MessageContent> = HashMap::new();
    results.insert(
        "child".to_string(),
        MessageContent::Node(MessageContentNode::ToolResult {
            tool_use_id: "child".to_string(),
            content: "R".to_string(),
            is_error: false,
            structured_patch: None,
            original_file: None,
            modified_file: None,
            images: vec![mainframe_types::content::ToolResultImage {
                media_type: "image/png".to_string(),
                data: "AAAA".to_string(),
            }],
            parent_tool_use_id: None,
        }),
    );
    let mut messages = vec![assistant(vec![tool_use("child", "Bash", Some("agent-tu"))])];
    attach_subagent_tool_results(&mut messages, &results);
    assert_eq!(messages[0].content.len(), 2);
    match &messages[0].content[1] {
        MessageContent::Node(MessageContentNode::ToolResult {
            tool_use_id,
            parent_tool_use_id,
            images,
            ..
        }) => {
            assert_eq!(tool_use_id, "child");
            // parentToolUseId inherited from the tool_use block.
            assert_eq!(parent_tool_use_id.as_deref(), Some("agent-tu"));
            // images carry through the field-by-field rebuild.
            assert_eq!(images.len(), 1);
            assert_eq!(images[0].media_type, "image/png");
        }
        _ => panic!("expected tool_result"),
    }
}

#[test]
fn capture_agent_id_mapping_links_agent_to_tool_use() {
    let mut map: HashMap<String, String> = HashMap::new();
    let entry = json!({
        "type": "user",
        "toolUseResult": { "agentId": "agent-9" },
        "message": { "content": [{ "type": "tool_result", "tool_use_id": "tu_parent" }] }
    });
    capture_agent_id_mapping(&entry, &mut map);
    assert_eq!(map.get("agent-9").map(String::as_str), Some("tu_parent"));
}
