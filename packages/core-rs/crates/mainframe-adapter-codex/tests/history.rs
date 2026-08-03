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

// --- thread/read reload tolerates item types added after this port ---

// Regression: Codex 0.144.3 emits items that `ThreadItem` doesn't know (e.g.
// `subAgentActivity`). Because `ThreadReadTurn.items` is a hard
// `Vec<ThreadItem>`, one unknown variant used to abort deserialization of the
// whole `thread/read` payload, so history failed to load and the transcript
// rendered empty (see codex:session "failed to load history: unknown variant
// `contextCompaction`"). Unknown items must be skipped, leaving the known ones
// intact. `contextCompaction` is a known variant now and survives the parse.
#[test]
fn thread_read_skips_unknown_item_types_instead_of_failing_the_whole_turn() {
    use mainframe_adapter_codex::types::ThreadReadResult;

    let payload = json!({
        "thread": {
            "id": "t1",
            "turns": [{
                "id": "turn1",
                "status": "completed",
                "items": [
                    { "id": "a1", "type": "agentMessage", "text": "before compaction", "phase": null },
                    { "id": "c1", "type": "contextCompaction", "summary": "…", "anythingElse": 42 },
                    { "id": "s1", "type": "subAgentActivity", "whatever": true },
                    { "id": "a2", "type": "agentMessage", "text": "after compaction", "phase": null }
                ]
            }]
        }
    });

    let read: ThreadReadResult = serde_json::from_value(payload)
        .expect("thread/read must deserialize despite unknown items");
    let all: Vec<ThreadItem> = read
        .thread
        .turns
        .unwrap_or_default()
        .into_iter()
        .flat_map(|t| t.items)
        .collect();

    // The unknown subAgentActivity drops; the known items survive in order.
    assert_eq!(all.len(), 3);
    assert!(matches!(&all[0], ThreadItem::AgentMessage(m) if m.text == "before compaction"));
    assert!(matches!(&all[1], ThreadItem::ContextCompaction(c) if c.id == "c1"));
    assert!(matches!(&all[2], ThreadItem::AgentMessage(m) if m.text == "after compaction"));
}

// --- convertThreadItems — contextCompaction → "Context compacted" pill ---

#[test]
fn context_compaction_item_becomes_a_system_compaction_message() {
    let out = convert(json!([
        { "id": "comp_1", "type": "contextCompaction" },
    ]));
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].r#type, ChatMessageType::System);
    assert_eq!(content_json(&out[0]), json!([{ "type": "compaction" }]));
    assert_eq!(out[0].chat_id, "chat1");
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

// --- convertThreadItems — imageGeneration ---

#[test]
fn converts_image_generation_with_inline_result_to_assistant_text_plus_image() {
    let out = convert(json!([
        {
            "id": "img1",
            "type": "imageGeneration",
            "result": "aGVsbG8=",
            "savedPath": "/tmp/out.png",
            "revisedPrompt": "a cat",
            "status": "completed"
        }
    ]));
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].r#type, ChatMessageType::Assistant);
    assert_eq!(
        content_json(&out[0]),
        json!([
            { "type": "text", "text": "a cat" },
            { "type": "image", "mediaType": "image/png", "data": "aGVsbG8=" }
        ])
    );
}

// `.png` (the no-savedPath sentinel) has a leading dot and no second dot, so Rust's
// `Path::extension()` treats it as a dotfile with no extension — same quirk the
// live path (`image_generation_render.rs`) already has; not this task's to fix.
#[test]
fn converts_image_generation_without_a_prompt_to_a_bare_image_block() {
    let out = convert(json!([
        {
            "id": "img2",
            "type": "imageGeneration",
            "result": "aGVsbG8=",
            "savedPath": null,
            "revisedPrompt": null,
            "status": "completed"
        }
    ]));
    assert_eq!(
        content_json(&out[0]),
        json!([{ "type": "image", "mediaType": "application/octet-stream", "data": "aGVsbG8=" }])
    );
}

#[test]
fn derives_the_image_media_type_from_the_saved_path_extension() {
    let out = convert(json!([
        {
            "id": "img3",
            "type": "imageGeneration",
            "result": "aGVsbG8=",
            "savedPath": "/tmp/out.bin",
            "revisedPrompt": "",
            "status": "completed"
        }
    ]));
    assert_eq!(
        content_json(&out[0]),
        json!([{ "type": "image", "mediaType": "application/octet-stream", "data": "aGVsbG8=" }])
    );
}

// A savedPath-only item (no inline result) needs a disk read to recover the image
// bytes; convert_thread_items returns a plain Vec synchronously with no sink to
// deliver a late-arriving message, so this reload case is dropped, not rendered.
#[test]
fn skips_image_generation_reload_when_only_a_saved_path_is_present() {
    let out = convert(json!([
        {
            "id": "img4",
            "type": "imageGeneration",
            "result": null,
            "savedPath": "/tmp/out.png",
            "revisedPrompt": null,
            "status": "completed"
        }
    ]));
    assert_eq!(out.len(), 0);
}

// --- convertThreadItems — webSearch ---

#[test]
fn converts_web_search_to_a_tool_use_plus_tool_result_pair_named_web_search() {
    let out = convert(json!([
        { "id": "ws1", "type": "webSearch", "query": "rust serde" }
    ]));
    assert_eq!(out.len(), 2);
    assert_eq!(out[0].r#type, ChatMessageType::Assistant);
    assert_eq!(
        content_json(&out[0]),
        json!([{ "type": "tool_use", "id": "ws1", "name": "WebSearch", "input": { "query": "rust serde" } }])
    );
    assert_eq!(out[1].r#type, ChatMessageType::ToolResult);
    assert_eq!(
        content_json(&out[1]),
        json!([{ "type": "tool_result", "toolUseId": "ws1", "content": "", "isError": false }])
    );
}

#[test]
fn sets_chat_id_on_all_messages() {
    let out = convert_with(
        json!([{ "id": "i1", "type": "agentMessage", "text": "Hi", "phase": null }]),
        "my-chat",
    );
    assert_eq!(out[0].chat_id, "my-chat");
}

// --- convertThreadItems — sub-agent cards on reload (todo #247, task 19/20) ---

fn card_blocks(out: &[ChatMessage]) -> Vec<Value> {
    out.iter()
        .flat_map(|m| m.content.iter())
        .map(|b| serde_json::to_value(b).unwrap())
        .collect()
}

#[test]
fn wait_naming_a_never_activated_child_opens_and_resolves_its_own_card() {
    let out = convert(json!([
        {
            "id": "call_wait1",
            "type": "collabAgentToolCall",
            "tool": "wait",
            "status": "completed",
            "receiverThreadIds": ["child1"],
            "agentsStates": { "child1": { "status": "completed", "message": "Found 3 files" } }
        }
    ]));
    let blocks = card_blocks(&out);

    let cards: Vec<&Value> = blocks
        .iter()
        .filter(|v| v["type"] == json!("tool_use") && v["name"] == json!("CollabAgent"))
        .collect();
    assert_eq!(cards.len(), 1, "expected exactly one card, got {cards:?}");
    assert_eq!(cards[0]["input"]["subagent_type"], json!("Sub-agent"));

    let results: Vec<&Value> = blocks
        .iter()
        .filter(|v| v["type"] == json!("tool_result") && v["toolUseId"] == json!("call_wait1"))
        .collect();
    assert_eq!(
        results.len(),
        1,
        "expected exactly one closing result, got {results:?}"
    );
    assert_eq!(results[0]["content"], json!("Found 3 files"));
    assert_eq!(results[0]["isError"], json!(false));
}

#[test]
fn sub_agent_activity_interrupted_resolves_the_card_as_an_error() {
    let out = convert(json!([
        {
            "id": "call_started2",
            "type": "subAgentActivity",
            "kind": "started",
            "agentThreadId": "child2",
            "agentPath": "/root/child2"
        },
        {
            "id": "call_interrupted2",
            "type": "subAgentActivity",
            "kind": "interrupted",
            "agentThreadId": "child2",
            "agentPath": "/root/child2"
        }
    ]));
    let blocks = card_blocks(&out);

    let results: Vec<&Value> = blocks
        .iter()
        .filter(|v| v["type"] == json!("tool_result") && v["toolUseId"] == json!("call_started2"))
        .collect();
    assert_eq!(
        results.len(),
        1,
        "expected exactly one closing result, got {results:?}"
    );
    assert_eq!(results[0]["content"], json!("Sub-agent interrupted"));
    assert_eq!(results[0]["isError"], json!(true));
}

#[test]
fn an_unnamed_failed_wait_resolves_every_open_card_as_an_error() {
    let out = convert(json!([
        {
            "id": "call_started3",
            "type": "subAgentActivity",
            "kind": "started",
            "agentThreadId": "child3",
            "agentPath": "/root/child3"
        },
        {
            "id": "call_started4",
            "type": "subAgentActivity",
            "kind": "started",
            "agentThreadId": "child4",
            "agentPath": "/root/child4"
        },
        {
            "id": "call_wait2",
            "type": "collabAgentToolCall",
            "tool": "wait",
            "status": "failed",
            "receiverThreadIds": []
        }
    ]));
    let blocks = card_blocks(&out);

    for card_id in ["call_started3", "call_started4"] {
        let results: Vec<&Value> = blocks
            .iter()
            .filter(|v| v["type"] == json!("tool_result") && v["toolUseId"] == json!(card_id))
            .collect();
        assert_eq!(
            results.len(),
            1,
            "expected {card_id} resolved, got {results:?}"
        );
        assert_eq!(results[0]["content"], json!("Sub-agent failed"));
        assert_eq!(results[0]["isError"], json!(true));
    }
}

#[test]
fn activity_and_receiver_route_naming_the_same_child_produce_one_card_on_reload() {
    let out = convert(json!([
        {
            "id": "call_started5",
            "type": "subAgentActivity",
            "kind": "started",
            "agentThreadId": "child5",
            "agentPath": "/root/child5_thing"
        },
        {
            "id": "call_wait3",
            "type": "collabAgentToolCall",
            "tool": "wait",
            "status": "completed",
            "receiverThreadIds": ["child5"],
            "agentsStates": { "child5": { "status": "completed", "message": "5 done" } }
        }
    ]));
    let blocks = card_blocks(&out);

    let cards: Vec<&Value> = blocks
        .iter()
        .filter(|v| v["type"] == json!("tool_use") && v["name"] == json!("CollabAgent"))
        .collect();
    assert_eq!(cards.len(), 1, "expected exactly one card, got {cards:?}");
    assert_eq!(cards[0]["input"]["subagent_type"], json!("child5 thing"));

    let results: Vec<&Value> = blocks
        .iter()
        .filter(|v| v["type"] == json!("tool_result") && v["toolUseId"] == json!("call_started5"))
        .collect();
    assert_eq!(
        results.len(),
        1,
        "expected the activity-route card resolved, got {results:?}"
    );
    assert_eq!(results[0]["content"], json!("5 done"));
}
