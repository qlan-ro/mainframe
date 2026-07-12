//! Ports `__tests__/collab-agent-spawn.test.ts` + `__tests__/plan-item-capture.test.ts`
//! assertion-for-assertion.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::Recorder;
use mainframe_adapter_codex::event_mapper::{
    CodexSessionState, CurrentTurnPlan, handle_notification,
};
use serde_json::{Value, json};

fn state() -> CodexSessionState {
    CodexSessionState {
        thread_id: Some("parent_thread".to_string()),
        current_turn_id: Some("turn_1".to_string()),
        ..Default::default()
    }
}

fn spawn_agent(status: &str) -> Value {
    json!({
        "id": "spawn_item_1",
        "type": "collabAgentToolCall",
        "tool": "spawnAgent",
        "status": status,
        "senderThreadId": "parent_thread",
        "receiverThreadIds": ["child_thread_1"],
        "prompt": "Investigate the codebase",
    })
}

fn wait_inprogress() -> Value {
    json!({
        "id": "wait_item_1",
        "type": "collabAgentToolCall",
        "tool": "wait",
        "status": "inProgress",
        "senderThreadId": "parent_thread",
        "receiverThreadIds": ["child_thread_1"],
        "prompt": null,
    })
}

fn wait_completed(status: &str) -> Value {
    json!({
        "id": "wait_item_1",
        "type": "collabAgentToolCall",
        "tool": "wait",
        "status": status,
        "senderThreadId": "parent_thread",
        "receiverThreadIds": ["child_thread_1"],
        "prompt": null,
        "agentsStates": { "child_thread_1": { "status": "completed", "message": "Found 3 files" } },
    })
}

fn dispatch_spawn(rec: &Recorder, state: &mut CodexSessionState) {
    let sink = rec.sink();
    handle_notification(
        "item/started",
        &json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": spawn_agent("inProgress") }),
        &sink,
        state,
    );
    handle_notification(
        "item/completed",
        &json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": spawn_agent("completed") }),
        &sink,
        state,
    );
}

fn to_values(blocks: &[mainframe_types::chat::MessageContent]) -> Value {
    serde_json::to_value(blocks).unwrap()
}

#[test]
fn spawn_agent_emits_no_card_and_only_stashes_the_prompt() {
    let rec = Recorder::new();
    let mut state = state();
    dispatch_spawn(&rec, &mut state);
    assert!(rec.messages().is_empty());
    assert!(rec.tool_results().is_empty());
    assert_eq!(
        state.spawn_prompts.get("child_thread_1"),
        Some(&"Investigate the codebase".to_string())
    );
}

#[test]
fn wait_started_opens_card_using_stashed_prompt_as_description() {
    let rec = Recorder::new();
    let mut state = state();
    dispatch_spawn(&rec, &mut state);
    handle_notification(
        "item/started",
        &json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": wait_inprogress() }),
        &rec.sink(),
        &mut state,
    );
    let messages = rec.messages();
    assert_eq!(messages.len(), 1);
    assert_eq!(
        to_values(&messages[0]),
        json!([{
            "type": "tool_use",
            "id": "wait_item_1",
            "name": "CollabAgent",
            "input": {
                "prompt": "Investigate the codebase",
                "description": "Investigate the codebase",
                "subagent_type": "Sub-agent",
            },
        }])
    );
}

#[test]
fn wait_completed_emits_tool_result_with_sub_agent_message_and_clears_state() {
    let rec = Recorder::new();
    let mut state = state();
    dispatch_spawn(&rec, &mut state);
    handle_notification(
        "item/started",
        &json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": wait_inprogress() }),
        &rec.sink(),
        &mut state,
    );
    rec.clear_messages();

    handle_notification(
        "item/completed",
        &json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": wait_completed("completed") }),
        &rec.sink(),
        &mut state,
    );

    assert!(rec.messages().is_empty());
    let results = rec.tool_results();
    assert_eq!(results.len(), 1);
    assert_eq!(
        to_values(&results[0]),
        json!([{ "type": "tool_result", "toolUseId": "wait_item_1", "content": "Found 3 files", "isError": false }])
    );
    assert!(!state.open_collab_cards.contains("wait_item_1"));
    assert!(!state.collab_child_threads.contains_key("child_thread_1"));
    assert!(!state.spawn_prompts.contains_key("child_thread_1"));
}

#[test]
fn wait_completed_without_prior_started_still_emits_both() {
    let rec = Recorder::new();
    let mut state = state();
    dispatch_spawn(&rec, &mut state);
    handle_notification(
        "item/completed",
        &json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": wait_completed("completed") }),
        &rec.sink(),
        &mut state,
    );
    assert_eq!(rec.messages().len(), 1);
    assert_eq!(rec.tool_results().len(), 1);
}

#[test]
fn failed_and_interrupted_wait_statuses_produce_is_error_true() {
    for status in ["failed", "interrupted"] {
        let rec = Recorder::new();
        let mut state = state();
        dispatch_spawn(&rec, &mut state);
        handle_notification(
            "item/completed",
            &json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": wait_completed(status) }),
            &rec.sink(),
            &mut state,
        );
        let results = rec.tool_results();
        assert_eq!(to_values(&results[0])[0]["isError"], json!(true));
    }
}

#[test]
fn child_thread_items_are_tagged_with_parent_tool_use_id() {
    let rec = Recorder::new();
    let mut state = state();
    dispatch_spawn(&rec, &mut state);
    handle_notification(
        "item/started",
        &json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": wait_inprogress() }),
        &rec.sink(),
        &mut state,
    );
    rec.clear_messages();

    handle_notification(
        "item/completed",
        &json!({
            "threadId": "child_thread_1",
            "turnId": "child_turn_1",
            "item": {
                "id": "cmd_1",
                "type": "commandExecution",
                "command": "ls",
                "aggregatedOutput": "a\nb",
                "exitCode": 0,
                "status": "completed",
            },
        }),
        &rec.sink(),
        &mut state,
    );

    let msg = to_values(&rec.messages()[0]);
    let res = to_values(&rec.tool_results()[0]);
    assert_eq!(msg[0]["type"], json!("tool_use"));
    assert_eq!(msg[0]["name"], json!("Bash"));
    assert_eq!(msg[0]["parentToolUseId"], json!("wait_item_1"));
    assert_eq!(res[0]["type"], json!("tool_result"));
    assert_eq!(res[0]["parentToolUseId"], json!("wait_item_1"));
}

#[test]
fn item_started_for_non_collab_items_is_ignored() {
    let rec = Recorder::new();
    let mut state = state();
    handle_notification(
        "item/started",
        &json!({
            "threadId": "parent_thread",
            "turnId": "turn_1",
            "item": { "id": "cmd_1", "type": "commandExecution", "command": "ls", "aggregatedOutput": "", "status": "in_progress" },
        }),
        &rec.sink(),
        &mut state,
    );
    assert!(rec.messages().is_empty());
}

// --- plan-item-capture.test.ts ---

fn plan_state() -> CodexSessionState {
    CodexSessionState {
        thread_id: Some("t1".to_string()),
        current_turn_id: Some("turn1".to_string()),
        ..Default::default()
    }
}

#[test]
fn accumulates_plan_delta_text_into_current_turn_plan() {
    let rec = Recorder::new();
    let mut state = plan_state();
    handle_notification(
        "item/plan/delta",
        &json!({ "itemId": "p1", "delta": "# Plan\n" }),
        &rec.sink(),
        &mut state,
    );
    handle_notification(
        "item/plan/delta",
        &json!({ "itemId": "p1", "delta": "Step 1\n" }),
        &rec.sink(),
        &mut state,
    );
    assert_eq!(
        state.current_turn_plan,
        Some(CurrentTurnPlan {
            id: "p1".to_string(),
            text: "# Plan\nStep 1\n".to_string()
        })
    );
}

#[test]
fn finalises_the_plan_when_a_plan_item_is_emitted() {
    let rec = Recorder::new();
    let mut state = plan_state();
    handle_notification(
        "item/plan/delta",
        &json!({ "itemId": "p2", "delta": "partial" }),
        &rec.sink(),
        &mut state,
    );
    handle_notification(
        "item/completed",
        &json!({ "item": { "id": "p2", "type": "plan", "text": "complete plan" } }),
        &rec.sink(),
        &mut state,
    );
    assert_eq!(
        state.current_turn_plan,
        Some(CurrentTurnPlan {
            id: "p2".to_string(),
            text: "complete plan".to_string()
        })
    );
}

#[test]
fn clears_current_turn_plan_on_turn_started() {
    let rec = Recorder::new();
    let mut state = plan_state();
    state.current_turn_plan = Some(CurrentTurnPlan {
        id: "old".to_string(),
        text: "stale".to_string(),
    });
    handle_notification(
        "turn/started",
        &json!({ "threadId": "t1", "turn": { "id": "turn2" } }),
        &rec.sink(),
        &mut state,
    );
    assert_eq!(state.current_turn_plan, None);
}

#[test]
fn clears_current_turn_plan_on_turn_completed() {
    let rec = Recorder::new();
    let mut state = plan_state();
    state.current_turn_plan = Some(CurrentTurnPlan {
        id: "p".to_string(),
        text: "x".to_string(),
    });
    handle_notification(
        "turn/completed",
        &json!({ "threadId": "t1", "turn": { "id": "turn1", "status": "completed", "items": [], "error": null } }),
        &rec.sink(),
        &mut state,
    );
    assert_eq!(state.current_turn_plan, None);
}

// Codex omits contextTokens in TS, so the sink falls back to the turn's usage
// input tokens (event-handler.ts:366). Rust's Option<i64> can't carry the
// undefined/null distinction, so the mapper resolves that fallback here by
// sending the turn's raw input usage as context_tokens.
#[test]
fn turn_completed_reports_context_tokens_from_prior_token_usage() {
    let rec = Recorder::new();
    let mut state = plan_state();
    handle_notification(
        "thread/tokenUsage/updated",
        &json!({ "threadId": "t1", "usage": { "input_tokens": 12_345, "cached_input_tokens": 200, "output_tokens": 42 } }),
        &rec.sink(),
        &mut state,
    );
    handle_notification(
        "turn/completed",
        &json!({ "threadId": "t1", "turn": { "id": "turn1", "status": "completed", "items": [], "error": null } }),
        &rec.sink(),
        &mut state,
    );
    let results = rec.results();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].context_tokens, Some(12_345));
}

#[test]
fn turn_completed_without_usage_reports_no_context_tokens() {
    let rec = Recorder::new();
    let mut state = plan_state();
    handle_notification(
        "turn/completed",
        &json!({ "threadId": "t1", "turn": { "id": "turn1", "status": "completed", "items": [], "error": null } }),
        &rec.sink(),
        &mut state,
    );
    let results = rec.results();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].context_tokens, None);
    assert_eq!(results[0].usage, None);
}
