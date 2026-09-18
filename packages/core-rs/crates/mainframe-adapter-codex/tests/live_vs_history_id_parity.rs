//! Group 2 task 21 (todo #350, R2.8/R3.15): live-vs-history id parity for
//! the Codex adapter, mirroring `mainframe-adapter-claude/tests/
//! live_vs_history_id_parity.rs`. Two cases drive one recorded rollout
//! (`collab-delegation-0.144.3.jsonl`, already the shared fixture behind
//! `tests/collab_delegation.rs` and `tests/collab_reload.rs`) through both
//! `handle_notification` (live) and `convert_thread_items` (reload), and
//! assert the two paths assign the same id.
//!
//! R3.16 (history resolves a sub-agent card against the turn that raised it,
//! not the child's own `turn/completed`) and R3.18 (sub-agent history mints
//! `rollout-{n}` for nested tool calls instead of the app-server item id —
//! `rollout_reader.rs`'s `next_id`, a raw-`.jsonl`-rescan path this crate's
//! captured JSON-RPC fixtures never exercise) are NOT covered here: neither
//! has a fixture in this crate that reproduces it, and fabricating one risks
//! pinning the wrong shape. Left as named, unverified findings for T22's
//! continuation rather than a guessed `#[ignore]`d test.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::collections::HashMap;
use std::fs;

use common::{Recorder, capture_path, replay_capture, temp_registry};
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use mainframe_adapter_codex::history::convert_thread_items;
use mainframe_adapter_codex::item_types::ThreadItem;
use mainframe_adapter_codex::thread_registry::AgentMetadata;
use serde_json::{Value, json};

const PARENT_THREAD_ID: &str = "019fafe0-1385-7662-a89d-2a1461966b2a";

/// Mirrors `collab_reload.rs::load_reload_inputs`: keeps only terminal
/// `item/completed` items, grouped by `threadId`.
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

fn reload_messages() -> Vec<mainframe_types::chat::ChatMessage> {
    let (items, child_items_by_thread) = load_reload_inputs();
    let agent_meta_by_thread: HashMap<String, AgentMetadata> = HashMap::new();
    convert_thread_items(
        &items,
        "chat1",
        &child_items_by_thread,
        &agent_meta_by_thread,
    )
}

fn collab_card_id(blocks: &[Value]) -> String {
    blocks
        .iter()
        .find(|v| v["type"] == json!("tool_use") && v["name"] == json!("CollabAgent"))
        .and_then(|v| v["id"].as_str())
        .expect("exactly one CollabAgent tool_use block")
        .to_string()
}

/// T21: the delegation card's id — independently derived on each path (live
/// from the `subAgentActivity` started ping, per `tests/collab_delegation.rs`'s
/// module doc; reload from `history_collab_resolve.rs::open_card`'s
/// `card_id` parameter) — must agree, or a client resuming mid-session and
/// reloading history for the same chat would see the card split in two.
#[test]
fn live_and_reload_agree_on_the_delegation_cards_id() {
    let rec = Recorder::new();
    let (_registry_dir, deps) = temp_registry(&[]);
    let mut state = CodexSessionState {
        registry_deps: Some(deps),
        ..CodexSessionState::default()
    };
    replay_capture(
        &capture_path("collab-delegation-0.144.3.jsonl"),
        &rec,
        &mut state,
    );
    let live_blocks: Vec<Value> = rec
        .messages()
        .iter()
        .flat_map(|blocks| blocks.iter())
        .map(|b| serde_json::to_value(b).expect("block serializes"))
        .collect();
    let live_card_id = collab_card_id(&live_blocks);

    let reload_blocks: Vec<Value> = reload_messages()
        .iter()
        .flat_map(|m| m.content.iter())
        .map(|b| serde_json::to_value(b).expect("block serializes"))
        .collect();
    let reload_card_id = collab_card_id(&reload_blocks);

    assert_eq!(live_card_id, reload_card_id);
}

/// T22, R3.17 (fixed): reload dropped every `dynamicToolCall` item silently
/// (`history_convert.rs`'s catch-all `_ => {}`) — no fixture in this crate's
/// captures contains one, so this drives a synthetic item through both
/// paths directly.
#[test]
fn dynamic_tool_call_reload_matches_the_live_tool_use_id_and_name() {
    let item = json!({
        "id": "dyn_1",
        "type": "dynamicToolCall",
        "namespace": "web",
        "tool": "search",
        "arguments": { "query": "rust serde" },
        "status": "completed",
    });

    let rec = Recorder::new();
    let mut live_state = CodexSessionState {
        thread_id: Some("t1".to_string()),
        current_turn_id: Some("turn_1".to_string()),
        ..CodexSessionState::default()
    };
    handle_notification(
        "item/completed",
        &json!({ "threadId": "t1", "turnId": "turn_1", "item": item.clone() }),
        &rec.sink(),
        &mut live_state,
    );
    let live_block = rec.messages()[0][0].clone();
    let live_value = serde_json::to_value(&live_block).unwrap();

    let thread_item: ThreadItem = serde_json::from_value(item).unwrap();
    let reload_messages = convert_thread_items(
        std::slice::from_ref(&thread_item),
        "chat1",
        &HashMap::new(),
        &HashMap::new(),
    );
    assert_eq!(reload_messages.len(), 1, "reload must no longer drop it");
    let reload_value = serde_json::to_value(&reload_messages[0].content[0]).unwrap();

    assert_eq!(live_value["id"], reload_value["id"]);
    assert_eq!(live_value["name"], reload_value["name"]);
    assert_eq!(live_value["id"], json!("dyn_1"));
    assert_eq!(live_value["name"], json!("web__search"));
}
