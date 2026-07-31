//! Ports `__tests__/collab-agent-spawn.test.ts` + `__tests__/plan-item-capture.test.ts`
//! assertion-for-assertion.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::{Recorder, temp_registry};
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
fn wait_completed_emits_tool_result_with_sub_agent_message_and_resolves_card() {
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
    // Design decision 4: a resolved card keeps its child-thread registration so a
    // late-arriving child item still nests, instead of leaking to the parent.
    assert!(!state.open_card_ids().contains(&"wait_item_1".to_string()));
    assert!(state.card_for_thread("child_thread_1").is_some());
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

// --- contextCompaction live mapping + thread/compacted dedupe ---
//
// Codex 0.144.3 emits the canonical v2 item `{"type":"contextCompaction","id":…}`
// through item/started → item/completed on every compaction path (verified in
// core/src/compact{,_remote,_remote_v2}.rs at rust-v0.144.3); the deprecated
// thread/compacted notification is kept only as a legacy fallback and must never
// double-emit the end pill.

fn compaction_item() -> Value {
    json!({ "id": "comp_1", "type": "contextCompaction" })
}

fn dispatch(rec: &Recorder, state: &mut CodexSessionState, method: &str, params: Value) {
    handle_notification(method, &params, &rec.sink(), state);
}

#[test]
fn context_compaction_item_started_then_completed_fires_start_and_end_exactly_once() {
    let rec = Recorder::new();
    let mut state = state();
    dispatch(
        &rec,
        &mut state,
        "item/started",
        json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": compaction_item() }),
    );
    assert_eq!(rec.compact_starts(), 1);
    assert_eq!(rec.compacts(), 0);

    dispatch(
        &rec,
        &mut state,
        "item/completed",
        json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": compaction_item() }),
    );
    assert_eq!(rec.compact_starts(), 1);
    assert_eq!(rec.compacts(), 1);
    assert!(rec.messages().is_empty());
    assert!(rec.tool_results().is_empty());
}

#[test]
fn legacy_thread_compacted_after_item_completed_does_not_double_emit() {
    let rec = Recorder::new();
    let mut state = state();
    dispatch(
        &rec,
        &mut state,
        "item/completed",
        json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": compaction_item() }),
    );
    dispatch(
        &rec,
        &mut state,
        "thread/compacted",
        json!({ "threadId": "parent_thread" }),
    );
    assert_eq!(rec.compacts(), 1);
}

#[test]
fn item_completed_after_legacy_thread_compacted_does_not_double_emit() {
    let rec = Recorder::new();
    let mut state = state();
    dispatch(
        &rec,
        &mut state,
        "thread/compacted",
        json!({ "threadId": "parent_thread" }),
    );
    dispatch(
        &rec,
        &mut state,
        "item/completed",
        json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": compaction_item() }),
    );
    assert_eq!(rec.compacts(), 1);
}

#[test]
fn legacy_thread_compacted_alone_still_fires_exactly_one_compact() {
    let rec = Recorder::new();
    let mut state = state();
    dispatch(
        &rec,
        &mut state,
        "thread/compacted",
        json!({ "threadId": "parent_thread" }),
    );
    assert_eq!(rec.compacts(), 1);
}

#[test]
fn turn_started_resets_the_dedupe_so_a_later_compaction_emits_again() {
    let rec = Recorder::new();
    let mut state = state();
    dispatch(
        &rec,
        &mut state,
        "item/completed",
        json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": compaction_item() }),
    );
    dispatch(
        &rec,
        &mut state,
        "turn/started",
        json!({ "threadId": "parent_thread", "turn": { "id": "turn_2" } }),
    );
    dispatch(
        &rec,
        &mut state,
        "item/completed",
        json!({ "threadId": "parent_thread", "turnId": "turn_2", "item": compaction_item() }),
    );
    assert_eq!(rec.compacts(), 2);
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

// --- B2: dynamicToolCall render + explicit skip arms for the B1 union additions ---

fn item_completed(rec: &Recorder, state: &mut CodexSessionState, item: Value) {
    handle_notification(
        "item/completed",
        &json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": item }),
        &rec.sink(),
        state,
    );
}

#[test]
fn dynamic_tool_call_renders_a_tool_use_block_namespaced_by_the_tool_source() {
    let rec = Recorder::new();
    let mut state = state();
    item_completed(
        &rec,
        &mut state,
        json!({
            "id": "dyn_1",
            "type": "dynamicToolCall",
            "namespace": "web",
            "tool": "search",
            "arguments": { "query": "rust serde" },
            "status": "completed",
        }),
    );
    let messages = rec.messages();
    assert_eq!(messages.len(), 1);
    assert_eq!(
        to_values(&messages[0]),
        json!([{
            "type": "tool_use",
            "id": "dyn_1",
            "name": "web__search",
            "input": { "query": "rust serde" },
        }])
    );
    assert!(rec.tool_results().is_empty());
}

#[test]
fn dynamic_tool_call_without_a_namespace_uses_the_bare_tool_name() {
    let rec = Recorder::new();
    let mut state = state();
    item_completed(
        &rec,
        &mut state,
        json!({
            "id": "dyn_2",
            "type": "dynamicToolCall",
            "tool": "lookup",
            "arguments": {},
            "status": "completed",
        }),
    );
    assert_eq!(
        to_values(&rec.messages()[0]),
        json!([{
            "type": "tool_use",
            "id": "dyn_2",
            "name": "lookup",
            "input": {},
        }])
    );
}

#[test]
fn web_search_renders_a_tool_use_and_tool_result_pair_named_web_search() {
    let rec = Recorder::new();
    let mut state = state();
    item_completed(
        &rec,
        &mut state,
        json!({ "id": "ws_1", "type": "webSearch", "query": "rust serde" }),
    );
    assert_eq!(
        to_values(&rec.messages()[0]),
        json!([{
            "type": "tool_use",
            "id": "ws_1",
            "name": "WebSearch",
            "input": { "query": "rust serde" },
        }])
    );
    let results = rec.tool_results();
    assert_eq!(results.len(), 1);
    assert_eq!(
        serde_json::to_value(&results[0]).unwrap(),
        json!([{
            "type": "tool_result",
            "toolUseId": "ws_1",
            "content": "",
            "isError": false,
        }])
    );
}

#[test]
fn entered_review_mode_is_skipped_without_any_sink_call() {
    let rec = Recorder::new();
    let mut state = state();
    item_completed(
        &rec,
        &mut state,
        json!({ "id": "rev_1", "type": "enteredReviewMode", "review": "focus on security" }),
    );
    assert!(rec.messages().is_empty());
    assert!(rec.tool_results().is_empty());
}

#[test]
fn exited_review_mode_is_skipped_without_any_sink_call() {
    let rec = Recorder::new();
    let mut state = state();
    item_completed(
        &rec,
        &mut state,
        json!({ "id": "rev_2", "type": "exitedReviewMode", "review": "focus on security" }),
    );
    assert!(rec.messages().is_empty());
    assert!(rec.tool_results().is_empty());
}

#[test]
fn image_view_is_skipped_without_any_sink_call() {
    let rec = Recorder::new();
    let mut state = state();
    item_completed(
        &rec,
        &mut state,
        json!({ "id": "img_1", "type": "imageView", "path": "/tmp/shot.png" }),
    );
    assert!(rec.messages().is_empty());
    assert!(rec.tool_results().is_empty());
}

#[test]
fn sleep_is_skipped_without_any_sink_call() {
    let rec = Recorder::new();
    let mut state = state();
    item_completed(
        &rec,
        &mut state,
        json!({ "id": "sleep_1", "type": "sleep", "durationMs": 500 }),
    );
    assert!(rec.messages().is_empty());
    assert!(rec.tool_results().is_empty());
}

// --- B3: subAgentActivity folds into the TaskCard lifecycle ---

fn activity_ping(kind: &str) -> Value {
    activity_ping_for(kind, "child_thread_1", "activity_1")
}

fn activity_ping_for(kind: &str, thread_id: &str, item_id: &str) -> Value {
    json!({
        "id": item_id,
        "type": "subAgentActivity",
        "kind": kind,
        "agentThreadId": thread_id,
        "agentPath": "/root/compute_sum",
    })
}

/// Every recorded message block that is a `CollabAgent` tool_use, across the
/// whole replay — used where a test cares only about card count, not shape.
fn collab_card_count(rec: &Recorder) -> usize {
    rec.messages()
        .iter()
        .flat_map(|blocks| blocks.iter())
        .filter(|b| {
            let v = to_values(std::slice::from_ref(b));
            v[0]["type"] == json!("tool_use") && v[0]["name"] == json!("CollabAgent")
        })
        .count()
}

// NOTE (deviation from the plan, task 13): `sub_agent_activity_interrupted_emits_error_result_and_keeps_card_open`
// asserted the interrupted card stayed open. Task 15's `resolve_card` sets
// `open = false` on every resolution, error included — "keeps card open" is
// stale under the target design, not just a renamed field, so it is folded
// into `sub_agent_activity_kinds_each_have_their_documented_effect` below
// instead of being fixed in place.
#[test]
fn sub_agent_activity_kinds_each_have_their_documented_effect() {
    // `started` registers the child thread and opens a card for it.
    {
        let rec = Recorder::new();
        let mut state = state();
        item_completed(&rec, &mut state, activity_ping("started"));
        assert_eq!(collab_card_count(&rec), 1);
        assert!(state.card_for_thread("child_thread_1").is_some());
    }

    // `interacted` on an already-open card emits nothing and leaves it open.
    {
        let rec = Recorder::new();
        let mut state = state();
        item_completed(&rec, &mut state, activity_ping("started"));
        rec.clear_messages();

        item_completed(&rec, &mut state, activity_ping("interacted"));

        assert!(rec.messages().is_empty());
        assert!(rec.tool_results().is_empty());
        assert!(
            state
                .card_for_thread("child_thread_1")
                .map(|c| c.open)
                .unwrap_or(false)
        );
    }

    // `interrupted` resolves the card with a single errored tool_result.
    {
        let rec = Recorder::new();
        let mut state = state();
        item_completed(&rec, &mut state, activity_ping("started"));
        rec.clear_messages();

        item_completed(&rec, &mut state, activity_ping("interrupted"));

        let results = rec.tool_results();
        assert_eq!(results.len(), 1);
        let block = to_values(&results[0]);
        assert_eq!(block[0]["isError"], json!(true));
        assert_eq!(block[0]["content"], json!("Sub-agent interrupted"));
    }
}

#[test]
fn sub_agent_activity_unknown_thread_is_noop() {
    let rec = Recorder::new();
    let mut state = state();
    item_completed(&rec, &mut state, activity_ping("interrupted"));
    assert!(rec.messages().is_empty());
    assert!(rec.tool_results().is_empty());
}

// --- Task 13 (todo #247): the 9 red-phase tests the plan names for group 2 ---

#[test]
fn receiver_list_route_still_produces_one_card_with_registry_title_and_state_map_result() {
    let rec = Recorder::new();
    let (_dir, deps) = temp_registry(&[("child_thread_1", Some("Maxwell"), None, None)]);
    let mut state = CodexSessionState {
        registry_deps: Some(deps),
        ..state()
    };
    dispatch_spawn(&rec, &mut state);
    handle_notification(
        "item/started",
        &json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": wait_inprogress() }),
        &rec.sink(),
        &mut state,
    );
    handle_notification(
        "item/completed",
        &json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": wait_completed("completed") }),
        &rec.sink(),
        &mut state,
    );

    let messages = rec.messages();
    assert_eq!(messages.len(), 1);
    let card = to_values(&messages[0]);
    assert_eq!(card[0]["input"]["subagent_type"], json!("Maxwell"));

    let results = rec.tool_results();
    assert_eq!(results.len(), 1);
    assert_eq!(to_values(&results[0])[0]["content"], json!("Found 3 files"));
}

#[test]
fn activity_and_receiver_list_naming_the_same_child_produce_one_card() {
    let rec = Recorder::new();
    let mut state = state();
    item_completed(&rec, &mut state, activity_ping("started"));
    dispatch_spawn(&rec, &mut state);
    handle_notification(
        "item/started",
        &json!({ "threadId": "parent_thread", "turnId": "turn_1", "item": wait_inprogress() }),
        &rec.sink(),
        &mut state,
    );

    assert_eq!(
        collab_card_count(&rec),
        1,
        "an activity ping and a receiver-list wait naming the same child must not double-card"
    );
}

#[test]
fn collab_tool_values_each_have_their_documented_effect() {
    for tool in [
        "spawnAgent",
        "sendInput",
        "resumeAgent",
        "closeAgent",
        "notATool",
    ] {
        let rec = Recorder::new();
        let mut state = state();
        item_completed(&rec, &mut state, activity_ping("started"));

        item_completed(
            &rec,
            &mut state,
            json!({
                "id": "call_1",
                "type": "collabAgentToolCall",
                "tool": tool,
                "status": "completed",
                "senderThreadId": "parent_thread",
                "receiverThreadIds": ["child_thread_1"],
            }),
        );

        assert_eq!(
            collab_card_count(&rec),
            1,
            "{tool} must leave exactly the one card the started activity opened"
        );
        assert!(
            rec.tool_results().is_empty(),
            "{tool} must not resolve the card"
        );
    }

    let rec = Recorder::new();
    let mut state = state();
    item_completed(&rec, &mut state, activity_ping("started"));
    item_completed(
        &rec,
        &mut state,
        json!({
            "id": "call_2",
            "type": "collabAgentToolCall",
            "tool": "wait",
            "status": "completed",
            "senderThreadId": "parent_thread",
            "receiverThreadIds": ["child_thread_1"],
            "agentsStates": { "child_thread_1": { "status": "completed", "message": "done" } },
        }),
    );
    assert_eq!(
        rec.tool_results().len(),
        1,
        "wait with a matching receiver must resolve the card exactly once"
    );
}

#[test]
fn failed_wait_resolves_its_card_as_an_error() {
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

    item_completed(&rec, &mut state, wait_completed("failed"));

    let results = rec.tool_results();
    assert_eq!(results.len(), 1);
    assert_eq!(to_values(&results[0])[0]["isError"], json!(true));
}

#[test]
fn completed_wait_after_an_interrupted_activity_leaves_the_card_errored_without_a_second_result() {
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

    item_completed(&rec, &mut state, activity_ping("interrupted"));
    assert_eq!(rec.tool_results().len(), 1);

    item_completed(&rec, &mut state, wait_completed("completed"));

    assert_eq!(
        rec.tool_results().len(),
        1,
        "a completed wait must not double-resolve a card an activity ping already errored"
    );
}

#[test]
fn no_test_in_this_file_compares_a_collab_call_status_to_interrupted() {
    // Built at runtime, not spelled out verbatim, so this assertion doesn't match
    // its own source and pass vacuously.
    let forbidden = format!("wait_completed({:?})", "interrupted");
    let source = include_str!("event_mapper.rs");
    assert!(
        !source.contains(&forbidden),
        "spec criterion 12: \"interrupted\" is not a valid collab-call status — that \
         terminal state arrives only via a subAgentActivity kind, never a wait status"
    );
}

#[test]
fn an_unnamed_completed_wait_leaves_open_cards_running() {
    let rec = Recorder::new();
    let mut state = state();
    item_completed(
        &rec,
        &mut state,
        activity_ping_for("started", "child_thread_1", "activity_1"),
    );
    item_completed(
        &rec,
        &mut state,
        activity_ping_for("started", "child_thread_2", "activity_2"),
    );
    assert_eq!(collab_card_count(&rec), 2);

    item_completed(
        &rec,
        &mut state,
        json!({
            "id": "wait_unnamed_1",
            "type": "collabAgentToolCall",
            "tool": "wait",
            "status": "",
            "senderThreadId": "parent_thread",
            "receiverThreadIds": [],
        }),
    );
    assert!(rec.tool_results().is_empty());
    assert!(
        state
            .card_for_thread("child_thread_1")
            .map(|c| c.open)
            .unwrap_or(false)
    );
    assert!(
        state
            .card_for_thread("child_thread_2")
            .map(|c| c.open)
            .unwrap_or(false)
    );

    item_completed(
        &rec,
        &mut state,
        json!({
            "id": "wait_unnamed_2",
            "type": "collabAgentToolCall",
            "tool": "wait",
            "status": "failed",
            "senderThreadId": "parent_thread",
            "receiverThreadIds": [],
        }),
    );
    let results = rec.tool_results();
    assert_eq!(
        results.len(),
        2,
        "an unnamed failed wait must error every still-open card"
    );
    assert!(
        results
            .iter()
            .all(|r| to_values(r)[0]["isError"] == json!(true))
    );
}

#[test]
fn unknown_thread_items_are_dropped_and_untagged_items_go_to_the_parent() {
    let rec = Recorder::new();
    let mut state = state();

    handle_notification(
        "item/completed",
        &json!({
            "threadId": "grandchild_thread",
            "turnId": "turn_1",
            "item": { "id": "unk_1", "type": "agentMessage", "text": "from the grandchild" },
        }),
        &rec.sink(),
        &mut state,
    );
    assert!(
        rec.messages().is_empty(),
        "an item from an unregistered, non-parent thread must be dropped, not leaked to the parent"
    );
    assert!(rec.tool_results().is_empty());

    handle_notification(
        "item/completed",
        &json!({
            "turnId": "turn_1",
            "item": { "id": "unk_2", "type": "agentMessage", "text": "untagged parent output" },
        }),
        &rec.sink(),
        &mut state,
    );
    assert_eq!(
        to_values(&rec.messages()[0]),
        json!([{ "type": "text", "text": "untagged parent output" }])
    );
}

#[test]
fn parent_turn_end_closes_a_still_open_card_with_the_childs_last_message() {
    let rec = Recorder::new();
    let mut state = state();
    item_completed(&rec, &mut state, activity_ping("started"));

    handle_notification(
        "item/completed",
        &json!({
            "threadId": "child_thread_1",
            "turnId": "child_turn_1",
            "item": { "id": "child_msg_1", "type": "agentMessage", "text": "the child's own final answer" },
        }),
        &rec.sink(),
        &mut state,
    );

    handle_notification(
        "turn/completed",
        &json!({ "threadId": "parent_thread", "turn": { "id": "turn_1", "status": "completed", "items": [], "error": null } }),
        &rec.sink(),
        &mut state,
    );

    let results: Vec<Value> = rec
        .tool_results()
        .iter()
        .map(|blocks| to_values(blocks))
        .filter(|v| v[0]["toolUseId"] == json!("activity_1"))
        .collect();
    assert_eq!(
        results.len(),
        1,
        "the parent's turn end must close a card the child never resolved itself"
    );
    assert_eq!(
        results[0][0]["content"],
        json!("the child's own final answer")
    );
    assert_eq!(results[0][0]["isError"], json!(false));
    assert_eq!(rec.results().len(), 1);
}

#[test]
fn card_renders_without_a_registry_row_or_rollout_path() {
    let rec = Recorder::new();
    let mut state = state();
    item_completed(&rec, &mut state, activity_ping("started"));

    let messages = rec.messages();
    let card = to_values(&messages[0]);
    assert_eq!(card[0]["input"]["subagent_type"], json!("compute sum"));

    handle_notification(
        "item/completed",
        &json!({
            "threadId": "child_thread_1",
            "turnId": "child_turn_1",
            "item": { "id": "child_msg_1", "type": "agentMessage", "text": "child output" },
        }),
        &rec.sink(),
        &mut state,
    );

    let nested = to_values(rec.messages().last().unwrap());
    assert_eq!(nested[0]["parentToolUseId"], json!("activity_1"));
    assert_eq!(nested[0]["text"], json!("child output"));
}

#[test]
fn hook_prompt_is_skipped_without_any_sink_call() {
    let rec = Recorder::new();
    let mut state = state();
    item_completed(
        &rec,
        &mut state,
        json!({
            "id": "hook_1",
            "type": "hookPrompt",
            "fragments": [{ "text": "run lint", "hookRunId": "run_1" }],
        }),
    );
    assert!(rec.messages().is_empty());
    assert!(rec.tool_results().is_empty());
}
