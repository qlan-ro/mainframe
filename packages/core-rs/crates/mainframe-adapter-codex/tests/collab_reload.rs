//! Todo #247 — reload-path counterpart to `tests/collab_delegation.rs` (spec
//! criterion 17). Replays the same captured Codex 0.144.3 notification stream,
//! but through `convert_thread_items` (the `thread/read` reload path) instead
//! of `handle_notification` (the live path), and asserts the reload produces
//! the same card shape the live replay does.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::collections::HashMap;
use std::fs;

use common::capture_path;
use mainframe_adapter_codex::history::convert_thread_items;
use mainframe_adapter_codex::item_types::ThreadItem;
use mainframe_adapter_codex::thread_registry::AgentMetadata;
use serde_json::{Value, json};

const PARENT_THREAD_ID: &str = "019fafe0-1385-7662-a89d-2a1461966b2a";
const CARD_ID: &str = "call_4Sektr7DEdLzGCaKGNEcUVl4";
const CHILD_FINAL_MESSAGE: &str = "4. Confirmed: 2 + 2 = 4.";

/// Reads the capture, keeps only the terminal `item/completed` items (what a
/// `thread/read` reload actually returns), and groups them by `threadId`: the
/// parent thread's items become `items`, every other thread's items become an
/// entry in `child_items_by_thread`. Items that don't parse as a known
/// `ThreadItem` are dropped, mirroring the tolerant reload path in
/// `tests/history.rs`'s `thread_read_skips_unknown_item_types...` test.
fn load_reload_inputs() -> (Vec<ThreadItem>, HashMap<String, Vec<ThreadItem>>) {
    let raw =
        fs::read_to_string(capture_path("collab-delegation-0.144.3.jsonl")).expect("read capture");
    let mut parent_items = Vec::new();
    let mut child_items_by_thread: HashMap<String, Vec<ThreadItem>> = HashMap::new();

    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(line).expect("capture line is valid JSON");
        if value.get("method").and_then(Value::as_str) != Some("item/completed") {
            continue;
        }
        let params = value.get("params").cloned().unwrap_or(Value::Null);
        let thread_id = params
            .get("threadId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let Some(item_value) = params.get("item").cloned() else {
            continue;
        };
        let Ok(item) = serde_json::from_value::<ThreadItem>(item_value) else {
            continue;
        };
        if thread_id == PARENT_THREAD_ID {
            parent_items.push(item);
        } else {
            child_items_by_thread
                .entry(thread_id)
                .or_default()
                .push(item);
        }
    }

    (parent_items, child_items_by_thread)
}

fn reload() -> Vec<mainframe_types::chat::ChatMessage> {
    let (items, child_items_by_thread) = load_reload_inputs();
    let agent_meta_by_thread: HashMap<String, AgentMetadata> = HashMap::new();
    convert_thread_items(
        &items,
        "chat1",
        &child_items_by_thread,
        &agent_meta_by_thread,
    )
}

fn all_blocks(messages: &[mainframe_types::chat::ChatMessage]) -> Vec<Value> {
    messages
        .iter()
        .flat_map(|m| m.content.iter())
        .map(|b| serde_json::to_value(b).expect("block serializes"))
        .collect()
}

#[test]
fn reload_reproduces_the_live_card() {
    let messages = reload();
    let blocks = all_blocks(&messages);

    let cards: Vec<&Value> = blocks
        .iter()
        .filter(|v| v["type"] == json!("tool_use") && v["name"] == json!("CollabAgent"))
        .collect();
    assert_eq!(
        cards.len(),
        1,
        "expected exactly one CollabAgent tool_use block on reload, got {cards:?}"
    );
    assert_eq!(cards[0]["input"]["subagent_type"], json!("compute sum"));
    assert!(
        !cards[0]["input"]["description"]
            .as_str()
            .expect("description is a string")
            .is_empty()
    );

    let nested: Vec<&Value> = blocks
        .iter()
        .filter(|v| v.get("parentToolUseId").and_then(Value::as_str) == Some(CARD_ID))
        .collect();
    assert!(
        nested.iter().any(|b| b["type"] == json!("thinking")),
        "expected the child's reasoning nested under the card, got {nested:?}"
    );
    assert!(
        nested
            .iter()
            .any(|b| b["type"] == json!("text") && b["text"] == json!(CHILD_FINAL_MESSAGE)),
        "expected the child's final message nested under the card, got {nested:?}"
    );

    let results: Vec<&Value> = blocks
        .iter()
        .filter(|v| v["type"] == json!("tool_result") && v["toolUseId"] == json!(CARD_ID))
        .collect();
    assert_eq!(
        results.len(),
        1,
        "expected exactly one tool_result closing the card on reload, got {results:?}"
    );
    assert_eq!(results[0]["content"], json!(CHILD_FINAL_MESSAGE));
}

#[test]
fn reload_emits_the_child_message_once() {
    let messages = reload();
    let occurrences = all_blocks(&messages)
        .iter()
        .filter(|v| v.get("text").and_then(Value::as_str) == Some(CHILD_FINAL_MESSAGE))
        .count();
    assert_eq!(
        occurrences, 1,
        "the child's final message must appear exactly once across the reload, not once as \
         its own thread's echo and again inside the card"
    );
}
