//! Ports `__tests__/history.test.ts` (convertThreadItems) assertion-for-assertion.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;

use mainframe_adapter_codex::history::convert_thread_items;
use mainframe_adapter_codex::item_types::ThreadItem;
use mainframe_types::chat::{ChatMessage, ChatMessageType};
use serde_json::{Value, json};

fn items(v: Value) -> Vec<ThreadItem> {
    serde_json::from_value(v).unwrap()
}

fn convert(v: Value) -> Vec<ChatMessage> {
    convert_with(v, "chat1")
}

fn convert_with(v: Value, chat_id: &str) -> Vec<ChatMessage> {
    let empty_items: HashMap<String, Vec<ThreadItem>> = HashMap::new();
    let empty_meta = HashMap::new();
    convert_thread_items(&items(v), chat_id, &empty_items, &empty_meta)
}

fn content_json(m: &ChatMessage) -> Value {
    serde_json::to_value(&m.content).unwrap()
}

// --- convertThreadItems — userMessage shapes ---

#[test]
fn extracts_text_from_content0_text_the_thread_read_shape() {
    let out = convert(
        json!([{ "id": "m1", "type": "userMessage", "content": [{ "type": "text", "text": "hello there" }] }]),
    );
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].r#type, ChatMessageType::User);
    assert_eq!(
        content_json(&out[0]),
        json!([{ "type": "text", "text": "hello there" }])
    );
}

#[test]
fn also_accepts_the_rollout_jsonl_shape_input_text() {
    let out = convert(
        json!([{ "id": "m1", "type": "userMessage", "content": [{ "type": "input_text", "text": "from rollout" }] }]),
    );
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].r#type, ChatMessageType::User);
    assert_eq!(
        content_json(&out[0]),
        json!([{ "type": "text", "text": "from rollout" }])
    );
}

#[test]
fn falls_back_to_the_legacy_top_level_item_text() {
    let out = convert(json!([{ "id": "m1", "type": "userMessage", "text": "legacy" }]));
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].r#type, ChatMessageType::User);
    assert_eq!(
        content_json(&out[0]),
        json!([{ "type": "text", "text": "legacy" }])
    );
}

#[test]
fn skips_user_message_items_with_no_usable_text() {
    let out = convert(json!([
        { "id": "m1", "type": "userMessage", "content": [{ "type": "text", "text": "" }] },
        { "id": "m2", "type": "userMessage" },
    ]));
    assert_eq!(out.len(), 0);
}

// --- convertThreadItems — stable/deterministic ids ---

fn base_items() -> Value {
    json!([
        { "id": "u1", "type": "userMessage", "content": [{ "type": "text", "text": "test message" }] },
        { "id": "a1", "type": "agentMessage", "text": "hi", "phase": null },
        { "id": "c1", "type": "commandExecution", "command": "ls", "aggregatedOutput": "out", "exitCode": 0, "status": "completed" },
        { "id": "f1", "type": "fileChange", "status": "completed", "changes": [{ "path": "x.ts", "kind": { "type": "add" }, "diff": "+hello\n" }] },
    ])
}

fn ids(v: Value) -> Vec<String> {
    convert(v).into_iter().map(|m| m.id).collect()
}

#[test]
fn produces_identical_message_ids_on_repeated_reconstructions() {
    assert_eq!(ids(base_items()), ids(base_items()));
}

#[test]
fn all_ids_are_unique_within_one_reconstruction() {
    let ids = ids(base_items());
    let unique: std::collections::HashSet<&String> = ids.iter().collect();
    assert_eq!(unique.len(), ids.len());
}

#[test]
fn appending_an_item_preserves_the_ids_of_the_original_messages_as_a_stable_prefix() {
    let base = ids(base_items());
    let mut extended = base_items();
    extended
        .as_array_mut()
        .unwrap()
        .push(json!({ "id": "a2", "type": "agentMessage", "text": "more", "phase": null }));
    let with_extra = ids(extended);
    assert_eq!(&with_extra[..base.len()], &base[..]);
}

// --- convertThreadItems — item-type conversions (codex-history.test.ts) ---

#[test]
fn converts_agent_message_to_assistant_text() {
    let out =
        convert(json!([{ "id": "i1", "type": "agentMessage", "text": "Hello", "phase": null }]));
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].r#type, ChatMessageType::Assistant);
    assert_eq!(
        content_json(&out[0]),
        json!([{ "type": "text", "text": "Hello" }])
    );
}

#[test]
fn converts_reasoning_to_assistant_thinking() {
    let out = convert(json!([
        { "id": "i1", "type": "reasoning", "summary": ["Let me think..."], "content": ["details"] }
    ]));
    assert_eq!(
        content_json(&out[0]),
        json!([{ "type": "thinking", "thinking": "Let me think..." }])
    );
}

#[test]
fn converts_command_execution_to_tool_use_plus_tool_result_pair() {
    let out = convert(json!([
        { "id": "i1", "type": "commandExecution", "command": "ls", "aggregatedOutput": "file.txt", "exitCode": 0, "status": "completed" }
    ]));
    assert_eq!(out.len(), 2);
    assert_eq!(out[0].r#type, ChatMessageType::Assistant);
    assert_eq!(content_json(&out[0])[0]["type"], json!("tool_use"));
    assert_eq!(out[1].r#type, ChatMessageType::ToolResult);
    let result = &content_json(&out[1])[0];
    assert_eq!(result["type"], json!("tool_result"));
    assert_eq!(result["toolUseId"], json!("i1"));
    assert_eq!(result["isError"], json!(false));
}

#[test]
fn converts_user_message_to_user_text() {
    let out = convert(json!([{ "id": "i1", "type": "userMessage", "text": "Fix the bug" }]));
    assert_eq!(out[0].r#type, ChatMessageType::User);
    assert_eq!(
        content_json(&out[0]),
        json!([{ "type": "text", "text": "Fix the bug" }])
    );
}

#[test]
fn converts_file_change_to_per_change_edit_write_tool_use_plus_tool_result() {
    let out = convert(json!([
        {
            "id": "i2",
            "type": "fileChange",
            "changes": [{ "path": "a.ts", "kind": { "type": "update", "move_path": null }, "diff": "" }],
            "status": "completed",
        }
    ]));
    assert_eq!(out.len(), 2);
    let tool_use = &content_json(&out[0])[0];
    assert_eq!(tool_use["name"], json!("Edit"));
    assert_eq!(tool_use["id"], json!("i2:0"));
}

#[test]
fn converts_mcp_tool_call_to_mcp_server_tool_tool_use_plus_tool_result() {
    let out = convert(json!([
        {
            "id": "i3",
            "type": "mcpToolCall",
            "server": "mcp",
            "tool": "search",
            "arguments": { "q": "foo" },
            "result": { "content": [{ "found": true }], "structuredContent": null, "_meta": null },
            "error": null,
            "status": "completed",
        }
    ]));
    assert_eq!(out.len(), 2);
    assert_eq!(content_json(&out[0])[0]["name"], json!("mcp__mcp__search"));
}

#[test]
fn sets_chat_id_on_all_messages() {
    let out = convert_with(
        json!([{ "id": "i1", "type": "agentMessage", "text": "Hi", "phase": null }]),
        "my-chat",
    );
    assert_eq!(out[0].chat_id, "my-chat");
}
