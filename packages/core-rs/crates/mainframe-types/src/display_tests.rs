use super::*;
use serde_json::{Value, json};

fn roundtrip<T>(v: Value)
where
    T: serde::de::DeserializeOwned + serde::Serialize,
{
    let parsed: T = serde_json::from_value(v.clone()).unwrap();
    let back = serde_json::to_value(&parsed).unwrap();
    assert_eq!(v, back);
}

#[test]
fn display_content_leaf_arm() {
    roundtrip::<DisplayContent>(json!({ "type": "text", "text": "Running tests..." }));
    roundtrip::<DisplayContent>(json!({ "type": "thinking", "thinking": "hmm" }));
}

#[test]
fn display_content_tool_call_with_result() {
    roundtrip::<DisplayContent>(json!({
        "type": "tool_call",
        "id": "toolu_02B",
        "name": "Read",
        "input": { "file_path": "x.ts" },
        "category": "explore",
        "result": {
            "content": "export function f() {}",
            "isError": false,
            "truncated": false,
            "fullBytes": 512
        }
    }));
}

#[test]
fn tool_call_result_images_roundtrip_and_omit_when_empty() {
    roundtrip::<DisplayContent>(json!({
        "type": "tool_call",
        "id": "toolu_03C",
        "name": "Read",
        "input": { "file_path": "img.png" },
        "category": "explore",
        "result": {
            "content": "",
            "isError": false,
            "images": [{ "mediaType": "image/png", "data": "AAAA" }]
        }
    }));
    let no_images: DisplayContent = serde_json::from_value(json!({
        "type": "tool_call",
        "id": "toolu_04D",
        "name": "Read",
        "input": {},
        "category": "explore",
        "result": { "content": "ok", "isError": false }
    }))
    .unwrap();
    assert!(
        !serde_json::to_string(&no_images)
            .unwrap()
            .contains("images")
    );
}

#[test]
fn display_content_nested_groups() {
    roundtrip::<DisplayContent>(json!({
        "type": "tool_group",
        "calls": [
            { "type": "tool_call", "id": "t1", "name": "Grep", "input": { "pattern": "x" }, "category": "explore" }
        ]
    }));
    roundtrip::<DisplayContent>(json!({
        "type": "task_group",
        "agentId": "agent_1",
        "taskArgs": { "description": "Investigate flake" },
        "calls": [ { "type": "text", "text": "Looking into it." } ],
        "result": { "content": "done", "isError": false }
    }));
    roundtrip::<DisplayContent>(json!({
        "type": "task_progress",
        "items": [
            { "id": "t4", "name": "Bash", "input": { "command": "pnpm test" }, "category": "progress" }
        ]
    }));
}

#[test]
fn display_content_permission_error_compaction() {
    roundtrip::<DisplayContent>(json!({
        "type": "permission_request",
        "request": {
            "requestId": "req_001",
            "toolName": "Bash",
            "toolUseId": "toolu_01A",
            "input": { "command": "rm -rf /tmp/scratch" },
            "suggestions": []
        }
    }));
    roundtrip::<DisplayContent>(json!({ "type": "error", "message": "Tool timed out" }));
    roundtrip::<DisplayContent>(json!({ "type": "compaction" }));
}

#[test]
fn display_message_minimal() {
    roundtrip::<DisplayMessage>(json!({
        "id": "dmsg_0001",
        "chatId": "chat_9f2a3b1c",
        "type": "user",
        "content": [ { "type": "text", "text": "Running tests..." } ],
        "timestamp": "2026-07-08T10:15:30.000Z"
    }));
}

#[test]
fn chat_history_payload_round_trips() {
    roundtrip::<ChatHistoryPayload>(json!({
        "messages": [],
        "transcriptMissing": true,
        "workflowRuns": []
    }));
    roundtrip::<ChatHistoryPayload>(json!({
        "messages": [
            {
                "id": "dmsg_0001",
                "chatId": "chat_9f2a3b1c",
                "type": "user",
                "content": [ { "type": "text", "text": "hi" } ],
                "timestamp": "2026-07-08T10:15:30.000Z"
            }
        ],
        "transcriptMissing": false,
        "workflowRuns": []
    }));
}
