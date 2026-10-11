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
fn todo_status_snake_case() {
    roundtrip::<TodoItem>(json!({
        "content": "Ship the fix",
        "status": "in_progress",
        "activeForm": "Shipping the fix"
    }));
}

#[test]
fn session_tuning_tristate() {
    // absent → None → omitted on the way back out
    let s = serde_json::to_string(&SessionTuning::default()).unwrap();
    assert_eq!(s, "{}");
    // present null → Some(None) → serializes null
    let v = json!({ "effort": null, "fast": true });
    roundtrip::<SessionTuning>(v.clone());
    let t: SessionTuning = serde_json::from_value(v).unwrap();
    assert_eq!(t.effort, Some(None));
    assert_eq!(t.fast, Some(Some(true)));
    // present value → Some(Some(v))
    roundtrip::<SessionTuning>(json!({ "effort": "high" }));
}

#[test]
fn chat_effort_null_roundtrips() {
    // effort present-null must survive as null on the wire.
    let v = json!({
        "id": "chat_1",
        "adapterId": "claude",
        "projectId": "proj_1",
        "status": "active",
        "createdAt": "t",
        "updatedAt": "t",
        "totalCost": 0.0,
        "totalTokensInput": 0,
        "totalTokensOutput": 0,
        "lastContextTokensInput": 0,
        "effort": null,
        "temporary": false,
        "noProject": false
    });
    roundtrip::<Chat>(v);
}

#[test]
fn chat_parent_chat_id_present_as_null_and_as_value() {
    // A fork's parent is absent (skipped) on an unrelated (non-fork) chat, present
    // as null when explicitly cleared/known-absent, and present as a value on a fork.
    let base = json!({
        "id": "chat_1",
        "adapterId": "claude",
        "projectId": "proj_1",
        "status": "active",
        "createdAt": "t",
        "updatedAt": "t",
        "totalCost": 0.0,
        "totalTokensInput": 0,
        "totalTokensOutput": 0,
        "lastContextTokensInput": 0,
        "temporary": false,
        "noProject": false
    });
    let no_parent: Chat = serde_json::from_value(base.clone()).unwrap();
    assert_eq!(no_parent.parent_chat_id, None);
    assert!(
        !serde_json::to_string(&no_parent)
            .unwrap()
            .contains("parentChatId")
    );

    let mut with_null = base.clone();
    with_null["parentChatId"] = Value::Null;
    roundtrip::<Chat>(with_null);

    let mut with_value = base;
    with_value["parentChatId"] = Value::String("chat_parent".to_string());
    roundtrip::<Chat>(with_value);
}

#[test]
fn chat_side_chat_id_and_waiting_are_absent_by_default_and_present_when_set() {
    let base = json!({
        "id": "chat_1",
        "adapterId": "claude",
        "projectId": "proj_1",
        "status": "active",
        "createdAt": "t",
        "updatedAt": "t",
        "totalCost": 0.0,
        "totalTokensInput": 0,
        "totalTokensOutput": 0,
        "lastContextTokensInput": 0,
        "temporary": false,
        "noProject": false
    });
    let no_side_chat: Chat = serde_json::from_value(base.clone()).unwrap();
    assert_eq!(no_side_chat.side_chat_id, None);
    assert_eq!(no_side_chat.side_chat_waiting, None);
    let serialized = serde_json::to_string(&no_side_chat).unwrap();
    assert!(!serialized.contains("sideChatId"));
    assert!(!serialized.contains("sideChatWaiting"));

    let mut with_side_chat = base;
    with_side_chat["sideChatId"] = Value::String("chat_side".to_string());
    with_side_chat["sideChatWaiting"] = Value::Bool(true);
    roundtrip::<Chat>(with_side_chat);
}

#[test]
fn project_null_parent_present() {
    // parentProjectId present as null (fixture route.projects-list) must
    // round-trip as null, not be omitted.
    roundtrip::<Project>(json!({
        "id": "proj_a1b2c3",
        "name": "mainframe",
        "path": "/Users/doru/Projects/mainframe",
        "createdAt": "2026-07-08T10:15:30.000Z",
        "lastOpenedAt": "2026-07-08T10:16:12.500Z",
        "parentProjectId": null
    }));
}

#[test]
fn message_content_leaf_and_node() {
    // Leaf arm
    roundtrip::<MessageContent>(json!({ "type": "text", "text": "hi" }));
    // Node arm: tool_result with structuredPatch
    roundtrip::<MessageContent>(json!({
        "type": "tool_result",
        "toolUseId": "toolu_01A",
        "content": "4\n",
        "isError": false,
        "structuredPatch": [
            { "oldStart": 1, "oldLines": 1, "newStart": 1, "newLines": 1, "lines": [" 4"] }
        ],
        "originalFile": "a.txt",
        "modifiedFile": "a.txt"
    }));
    // Node arm: tool_use
    roundtrip::<MessageContent>(json!({
        "type": "tool_use",
        "id": "toolu_01A",
        "name": "Bash",
        "input": { "command": "echo 4" }
    }));
    // Node arm: tool_result with images — omitted when empty,
    // present in source order when populated.
    roundtrip::<MessageContent>(json!({
        "type": "tool_result",
        "toolUseId": "toolu_02B",
        "content": "",
        "isError": false,
        "images": [{ "mediaType": "image/png", "data": "AAAA" }]
    }));
    let no_images: MessageContent = serde_json::from_value(json!({
        "type": "tool_result",
        "toolUseId": "toolu_03C",
        "content": "ok",
        "isError": false
    }))
    .unwrap();
    assert!(
        !serde_json::to_string(&no_images)
            .unwrap()
            .contains("images")
    );
}

#[test]
fn queued_message_ref_minimal_and_full() {
    roundtrip::<QueuedMessageRef>(json!({
        "messageId": "dmsg_0003",
        "chatId": "chat_9f2a3b1c",
        "uuid": "a1b2c3d4",
        "content": "Continue with the fix",
        "timestamp": "2026-07-08T10:15:30.000Z"
    }));
    roundtrip::<QueuedMessageRef>(json!({
        "messageId": "dmsg_0003",
        "chatId": "chat_9f2a3b1c",
        "uuid": "a1b2c3d4",
        "content": "Continue with the fix",
        "timestamp": "2026-07-08T10:15:30.000Z",
        "attachmentIds": ["att_001", "att_002"]
    }));
}
