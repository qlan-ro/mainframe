//! Todo #247 — capture replay tests pinning the target Codex sub-agent
//! delegation card shape (spec criteria 1-7). Replays the real captured
//! notification sequence from Codex 0.144.3, where the `wait` call's
//! `receiverThreadIds` and `agentsStates` are both empty and the only signal
//! naming the child is the `subAgentActivity` `started` ping (spec decision 1:
//! the card id is that ping's own item id, the spawn call id).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::{Recorder, capture_path, replay_capture, temp_registry};
use mainframe_adapter_codex::event_mapper::CodexSessionState;
use serde_json::{Value, json};

const CARD_ID: &str = "call_4Sektr7DEdLzGCaKGNEcUVl4";
const CHILD_FINAL_MESSAGE: &str = "4. Confirmed: 2 + 2 = 4.";
const PARENT_DELEGATING_MESSAGE: &str =
    "I\u{2019}m delegating the calculation now, then I\u{2019}ll wait for the result.";
const PARENT_CLOSING_MESSAGE: &str = "The sub-agent reported: **2 + 2 = 4**.";

/// Pinned to an empty throwaway registry on purpose. `CodexSessionState::default()`
/// leaves `registry_deps: None`, which reads the developer's real
/// `~/.codex/state_5.sqlite` — and the capture replays a live session whose child
/// thread id is in it, so running the delegation flow once locally rewrites the
/// card title to that run's `agent_nickname` and reds these tests on that machine
/// only. No rows means no registry metadata, which is what the capture's own
/// `wait` payload carries.
fn replay() -> Recorder {
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
    rec
}

fn collab_tool_use_blocks(rec: &Recorder) -> Vec<Value> {
    rec.messages()
        .iter()
        .flat_map(|blocks| blocks.iter())
        .map(|b| serde_json::to_value(b).expect("block serializes"))
        .filter(|v| v["type"] == "tool_use" && v["name"] == "CollabAgent")
        .collect()
}

#[test]
fn renders_exactly_one_sub_agent_card() {
    let rec = replay();
    let cards = collab_tool_use_blocks(&rec);
    assert_eq!(
        cards.len(),
        1,
        "expected exactly one CollabAgent tool_use block, got {cards:?}"
    );
}

#[test]
fn card_title_is_the_humanized_agent_path() {
    let rec = replay();
    let cards = collab_tool_use_blocks(&rec);
    let subagent_type = cards[0]["input"]["subagent_type"]
        .as_str()
        .expect("subagent_type is a string");
    assert_eq!(subagent_type, "compute sum");
    assert_ne!(subagent_type, "Sub-agent");
}

#[test]
fn card_task_line_is_non_empty() {
    let rec = replay();
    let cards = collab_tool_use_blocks(&rec);
    let description = cards[0]["input"]["description"]
        .as_str()
        .expect("description is a string");
    assert_eq!(description, "compute sum");
    assert!(!description.is_empty());
}

#[test]
fn nested_transcript_carries_the_child_thinking_then_final_message() {
    let rec = replay();
    let nested = rec.nested_blocks(CARD_ID);
    assert_eq!(
        nested.len(),
        2,
        "expected [thinking, text] nested under the card, got {nested:?}"
    );
    assert_eq!(nested[0]["type"], json!("thinking"));
    assert_eq!(nested[0]["thinking"], json!(""));
    assert_eq!(nested[1]["type"], json!("text"));
    assert_eq!(nested[1]["text"], json!(CHILD_FINAL_MESSAGE));
}

#[test]
fn card_result_is_the_child_final_message() {
    let rec = replay();
    let results: Vec<Value> = rec
        .tool_results()
        .iter()
        .flat_map(|blocks| blocks.iter())
        .map(|b| serde_json::to_value(b).expect("block serializes"))
        .filter(|v| v["toolUseId"] == json!(CARD_ID))
        .collect();
    assert_eq!(
        results.len(),
        1,
        "expected exactly one tool_result for the card, got {results:?}"
    );
    assert_eq!(results[0]["content"], json!(CHILD_FINAL_MESSAGE));
    assert_eq!(results[0]["isError"], json!(false));
}

#[test]
fn child_output_never_reaches_the_parent_conversation() {
    let rec = replay();
    let top_level = rec.top_level_blocks();

    let leaked_final_message = top_level
        .iter()
        .any(|b| b["type"] == json!("text") && b["text"] == json!(CHILD_FINAL_MESSAGE));
    assert!(
        !leaked_final_message,
        "the child's final message leaked into the parent conversation at top level"
    );

    // Both the parent's own reasoning item and the child's are empty text, so the
    // only way to catch the leak is by count: exactly one top-level reasoning
    // block belongs to the parent turn; a second means the child's reasoning
    // escaped its card.
    let top_level_thinking_blocks = top_level.iter().filter(|b| b["type"] == "thinking").count();
    assert_eq!(
        top_level_thinking_blocks, 1,
        "the child's reasoning leaked into the parent conversation as an extra top-level thinking block"
    );

    let parent_texts: Vec<&str> = top_level
        .iter()
        .filter(|b| b["type"] == json!("text"))
        .filter_map(|b| b["text"].as_str())
        .collect();
    assert!(
        parent_texts.contains(&PARENT_DELEGATING_MESSAGE),
        "missing the parent's delegating message at top level: {parent_texts:?}"
    );
    assert!(
        parent_texts.contains(&PARENT_CLOSING_MESSAGE),
        "missing the parent's closing message at top level: {parent_texts:?}"
    );
}

#[test]
fn sub_agent_turn_lifecycle_does_not_produce_a_parent_result() {
    let rec = replay();
    assert_eq!(
        rec.results().len(),
        1,
        "expected exactly one SessionResult across the replay, got {:?}",
        rec.results()
    );
}

#[test]
fn sub_agent_token_usage_does_not_reach_the_parent_result() {
    let rec = replay();
    let results = rec.results();
    let last = results.last().expect("at least one SessionResult");
    let usage = last
        .usage
        .as_ref()
        .expect("the parent result carries usage");
    assert_eq!(usage.input_tokens, Some(20_641));
    assert_ne!(
        usage.input_tokens,
        Some(20_638),
        "the parent result must not carry the sub-agent's own token usage"
    );
}
