//! Ported from
//! `packages/core/src/messages/__tests__/apply-tool-grouping-characterization.test.ts`.
//!
//! CHARACTERIZATION TESTS for `apply_tool_grouping` (WS14b safety net): pins the
//! current interleaving / grouping / progress-accumulation / task-group-nesting /
//! hidden-suppression behavior. Assertions run against serde_json Values to mirror
//! the TS deep-equality `toEqual`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use mainframe_adapter_claude::messages::display_helpers::apply_tool_grouping;
use mainframe_types::display::{DisplayContent, ToolCategories};
use serde_json::{Value, json};

// TodoWrite is in BOTH hidden and progress (mirrors ClaudeAdapter's V2 task
// tools) — pins that progress takes precedence over hidden.
fn cat() -> ToolCategories {
    serde_json::from_value(json!({
        "explore": ["Read", "Grep", "Glob", "LS"],
        "hidden": ["HiddenTool", "TodoWrite"],
        "progress": ["TodoWrite"],
        "subagent": ["Task", "Agent"],
    }))
    .unwrap()
}

fn run(input: Value) -> Vec<Value> {
    let content: Vec<DisplayContent> = serde_json::from_value(input).unwrap();
    let out = apply_tool_grouping(content, &cat());
    out.iter()
        .map(|c| serde_json::to_value(c).unwrap())
        .collect()
}

// ── 1. positional interleaving ─────────────────────────────────────────────
#[test]
fn text_explore_thinking_explore_text_each_element_stays_in_slot() {
    let out = run(json!([
        { "type": "text", "text": "First text" },
        { "type": "tool_call", "id": "tc1", "name": "Read", "input": { "path": "/a" }, "category": "explore" },
        { "type": "thinking", "thinking": "some thought" },
        { "type": "tool_call", "id": "tc2", "name": "Grep", "input": { "pattern": "foo" }, "category": "explore" },
        { "type": "text", "text": "Last text" },
    ]));
    assert_eq!(out.len(), 5);
    assert_eq!(out[0], json!({ "type": "text", "text": "First text" }));
    assert_eq!(
        out[1],
        json!({ "type": "tool_call", "id": "tc1", "name": "Read", "input": { "path": "/a" }, "category": "explore" })
    );
    assert_eq!(
        out[2],
        json!({ "type": "thinking", "thinking": "some thought" })
    );
    assert_eq!(
        out[3],
        json!({ "type": "tool_call", "id": "tc2", "name": "Grep", "input": { "pattern": "foo" }, "category": "explore" })
    );
    assert_eq!(out[4], json!({ "type": "text", "text": "Last text" }));
}

#[test]
fn explore_image_explore_text_image_stays_between_solo_explores() {
    let out = run(json!([
        { "type": "tool_call", "id": "tc1", "name": "Read", "input": { "path": "/a" }, "category": "explore" },
        { "type": "image", "mediaType": "image/png", "data": "base64data" },
        { "type": "tool_call", "id": "tc2", "name": "Grep", "input": { "pattern": "foo" }, "category": "explore" },
        { "type": "text", "text": "End" },
    ]));
    assert_eq!(out.len(), 4);
    assert_eq!(
        out[0],
        json!({ "type": "tool_call", "id": "tc1", "name": "Read", "input": { "path": "/a" }, "category": "explore" })
    );
    assert_eq!(
        out[1],
        json!({ "type": "image", "mediaType": "image/png", "data": "base64data" })
    );
    assert_eq!(
        out[2],
        json!({ "type": "tool_call", "id": "tc2", "name": "Grep", "input": { "pattern": "foo" }, "category": "explore" })
    );
    assert_eq!(out[3], json!({ "type": "text", "text": "End" }));
}

#[test]
fn explore_explore_thinking_explore_first_pair_groups_thinking_stays_last_solo() {
    let out = run(json!([
        { "type": "tool_call", "id": "e1", "name": "Read", "input": { "path": "/a" }, "category": "explore" },
        { "type": "tool_call", "id": "e2", "name": "Grep", "input": { "pattern": "x" }, "category": "explore" },
        { "type": "thinking", "thinking": "mid-thought" },
        { "type": "tool_call", "id": "e3", "name": "LS", "input": { "path": "/" }, "category": "explore" },
    ]));
    assert_eq!(out.len(), 3);
    assert_eq!(out[0]["type"], "tool_group");
    assert_eq!(out[0]["calls"].as_array().unwrap().len(), 2);
    assert_eq!(out[0]["calls"][0]["id"], "e1");
    assert_eq!(out[0]["calls"][1]["id"], "e2");
    assert_eq!(
        out[1],
        json!({ "type": "thinking", "thinking": "mid-thought" })
    );
    assert_eq!(
        out[2],
        json!({ "type": "tool_call", "id": "e3", "name": "LS", "input": { "path": "/" }, "category": "explore" })
    );
}

// ── 2. non-groupable sandwiched inside an explore run ───────────────────────
#[test]
fn explore_thinking_explore_explore_thinking_breaks_first_into_solo() {
    let out = run(json!([
        { "type": "tool_call", "id": "tc1", "name": "Read", "input": { "path": "/a" }, "category": "explore" },
        { "type": "thinking", "thinking": "interruption" },
        { "type": "tool_call", "id": "tc2", "name": "Grep", "input": { "pattern": "foo" }, "category": "explore" },
        { "type": "tool_call", "id": "tc3", "name": "LS", "input": { "path": "/" }, "category": "explore" },
    ]));
    assert_eq!(out.len(), 3);
    assert_eq!(
        out[0],
        json!({ "type": "tool_call", "id": "tc1", "name": "Read", "input": { "path": "/a" }, "category": "explore" })
    );
    assert_eq!(
        out[1],
        json!({ "type": "thinking", "thinking": "interruption" })
    );
    assert_eq!(out[2]["type"], "tool_group");
    assert_eq!(out[2]["calls"].as_array().unwrap().len(), 2);
    assert_eq!(out[2]["calls"][0]["id"], "tc2");
    assert_eq!(out[2]["calls"][1]["id"], "tc3");
}

#[test]
fn explore_pair_thinking_explore_pair_two_groups_separated_by_thinking() {
    let out = run(json!([
        { "type": "tool_call", "id": "e1", "name": "Read", "input": { "path": "/a" }, "category": "explore" },
        { "type": "tool_call", "id": "e2", "name": "Grep", "input": { "pattern": "x" }, "category": "explore" },
        { "type": "thinking", "thinking": "between groups" },
        { "type": "tool_call", "id": "e3", "name": "Glob", "input": { "pattern": "*.ts" }, "category": "explore" },
        { "type": "tool_call", "id": "e4", "name": "LS", "input": { "path": "/" }, "category": "explore" },
    ]));
    assert_eq!(out.len(), 3);
    assert_eq!(out[0]["type"], "tool_group");
    assert_eq!(
        out[1],
        json!({ "type": "thinking", "thinking": "between groups" })
    );
    assert_eq!(out[2]["type"], "tool_group");
    assert_eq!(out[0]["calls"][0]["id"], "e1");
    assert_eq!(out[0]["calls"][1]["id"], "e2");
    assert_eq!(out[2]["calls"][0]["id"], "e3");
    assert_eq!(out[2]["calls"][1]["id"], "e4");
}

// ── 3. single lone explore tool ─────────────────────────────────────────────
#[test]
fn a_single_explore_tool_is_not_wrapped() {
    let out = run(json!([
        { "type": "tool_call", "id": "tc1", "name": "Read", "input": { "path": "/a" }, "category": "explore" },
    ]));
    assert_eq!(out.len(), 1);
    assert_eq!(out[0]["type"], "tool_call");
    assert_eq!(
        out[0],
        json!({ "type": "tool_call", "id": "tc1", "name": "Read", "input": { "path": "/a" }, "category": "explore" })
    );
}

#[test]
fn exactly_two_consecutive_explore_tools_are_wrapped() {
    let out = run(json!([
        { "type": "tool_call", "id": "e1", "name": "Read", "input": { "path": "/a" }, "category": "explore" },
        { "type": "tool_call", "id": "e2", "name": "Grep", "input": { "pattern": "x" }, "category": "explore" },
    ]));
    assert_eq!(out.len(), 1);
    assert_eq!(out[0]["type"], "tool_group");
    assert_eq!(out[0]["calls"].as_array().unwrap().len(), 2);
    assert_eq!(out[0]["calls"][0]["id"], "e1");
    assert_eq!(out[0]["calls"][1]["id"], "e2");
}

#[test]
fn two_explore_runs_separated_by_default_each_form_own_group() {
    let out = run(json!([
        { "type": "tool_call", "id": "e1", "name": "Read", "input": { "path": "/a" }, "category": "explore" },
        { "type": "tool_call", "id": "e2", "name": "Grep", "input": { "pattern": "x" }, "category": "explore" },
        { "type": "tool_call", "id": "w1", "name": "Write", "input": { "path": "/b", "content": "x" }, "category": "default" },
        { "type": "tool_call", "id": "e3", "name": "Read", "input": { "path": "/c" }, "category": "explore" },
        { "type": "tool_call", "id": "e4", "name": "LS", "input": { "path": "/" }, "category": "explore" },
    ]));
    assert_eq!(out.len(), 3);
    assert_eq!(out[0]["type"], "tool_group");
    assert_eq!(
        out[1],
        json!({ "type": "tool_call", "id": "w1", "name": "Write", "input": { "path": "/b", "content": "x" }, "category": "default" })
    );
    assert_eq!(out[2]["type"], "tool_group");
    assert_eq!(out[0]["calls"].as_array().unwrap().len(), 2);
    assert_eq!(out[2]["calls"].as_array().unwrap().len(), 2);
    assert_eq!(out[0]["calls"][0]["id"], "e1");
    assert_eq!(out[0]["calls"][1]["id"], "e2");
    assert_eq!(out[2]["calls"][0]["id"], "e3");
    assert_eq!(out[2]["calls"][1]["id"], "e4");
}

// ── 4. _TaskProgress accumulation + insertion position ──────────────────────
#[test]
fn consecutive_progress_tools_accumulated_at_first_seen_position() {
    let out = run(json!([
        { "type": "text", "text": "Before" },
        { "type": "tool_call", "id": "tp1", "name": "TodoWrite", "input": { "task": "a" }, "category": "progress" },
        { "type": "tool_call", "id": "tp2", "name": "TodoWrite", "input": { "task": "b" }, "category": "progress" },
        { "type": "text", "text": "After" },
    ]));
    assert_eq!(out.len(), 3);
    assert_eq!(out[0], json!({ "type": "text", "text": "Before" }));
    assert_eq!(out[1]["type"], "task_progress");
    assert_eq!(out[1]["items"].as_array().unwrap().len(), 2);
    assert_eq!(out[1]["items"][0]["id"], "tp1");
    assert_eq!(out[1]["items"][0]["category"], "progress");
    assert_eq!(out[1]["items"][1]["id"], "tp2");
    assert_eq!(out[2], json!({ "type": "text", "text": "After" }));
}

#[test]
fn scattered_progress_tools_both_accumulated_none_dropped() {
    let out = run(json!([
        { "type": "text", "text": "Before" },
        { "type": "tool_call", "id": "tp1", "name": "TodoWrite", "input": { "task": "a" }, "category": "progress" },
        { "type": "tool_call", "id": "tc1", "name": "Read", "input": { "path": "/a" }, "category": "explore" },
        { "type": "tool_call", "id": "tp2", "name": "TodoWrite", "input": { "task": "b" }, "category": "progress" },
        { "type": "text", "text": "After" },
    ]));
    assert_eq!(out.len(), 4);
    assert_eq!(out[0], json!({ "type": "text", "text": "Before" }));
    assert_eq!(out[1]["type"], "task_progress");
    assert_eq!(out[1]["items"].as_array().unwrap().len(), 2);
    assert_eq!(out[1]["items"][0]["id"], "tp1");
    assert_eq!(out[1]["items"][1]["id"], "tp2");
    assert_eq!(
        out[2],
        json!({ "type": "tool_call", "id": "tc1", "name": "Read", "input": { "path": "/a" }, "category": "explore" })
    );
    assert_eq!(out[3], json!({ "type": "text", "text": "After" }));
}

#[test]
fn progress_insert_position_at_slot_of_first_progress_tool() {
    let out = run(json!([
        { "type": "text", "text": "A" },
        { "type": "text", "text": "B" },
        { "type": "tool_call", "id": "tp1", "name": "TodoWrite", "input": { "task": "x" }, "category": "progress" },
        { "type": "tool_call", "id": "tp2", "name": "TodoWrite", "input": { "task": "y" }, "category": "progress" },
        { "type": "text", "text": "C" },
    ]));
    assert_eq!(out.len(), 4);
    assert_eq!(out[0], json!({ "type": "text", "text": "A" }));
    assert_eq!(out[1], json!({ "type": "text", "text": "B" }));
    assert_eq!(out[2]["type"], "task_progress");
    assert_eq!(out[3], json!({ "type": "text", "text": "C" }));
}

// ── 5. task_group nesting ───────────────────────────────────────────────────
#[test]
fn task_group_children_explore_pair_nested_group_thinking_after_in_position() {
    let out = run(json!([
        { "type": "tool_call", "id": "agent1", "name": "Task", "input": { "description": "do work" }, "category": "subagent" },
        { "type": "tool_call", "id": "c1", "name": "Read", "input": { "path": "/a" }, "category": "explore", "parentToolUseId": "agent1" },
        { "type": "tool_call", "id": "c2", "name": "Grep", "input": { "pattern": "x" }, "category": "explore", "parentToolUseId": "agent1" },
        { "type": "thinking", "thinking": "child thought", "parentToolUseId": "agent1" },
        { "type": "tool_call", "id": "c3", "name": "LS", "input": { "path": "/" }, "category": "explore", "parentToolUseId": "agent1" },
    ]));
    assert_eq!(out.len(), 1);
    assert_eq!(out[0]["type"], "task_group");
    assert_eq!(out[0]["agentId"], "agent1");
    assert_eq!(out[0]["taskArgs"], json!({ "description": "do work" }));
    let calls = out[0]["calls"].as_array().unwrap();
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[0]["type"], "tool_group");
    assert_eq!(calls[0]["calls"].as_array().unwrap().len(), 2);
    assert_eq!(calls[0]["calls"][0]["id"], "c1");
    assert_eq!(calls[0]["calls"][0]["name"], "Read");
    assert_eq!(calls[0]["calls"][1]["id"], "c2");
    assert_eq!(calls[0]["calls"][1]["name"], "Grep");
    assert_eq!(
        calls[1],
        json!({ "type": "thinking", "thinking": "child thought", "parentToolUseId": "agent1" })
    );
    assert_eq!(
        calls[2],
        json!({ "type": "tool_call", "id": "c3", "name": "LS", "input": { "path": "/" }, "category": "explore", "parentToolUseId": "agent1" })
    );
}

#[test]
fn task_group_children_thinking_before_explore_pair_stays_at_index_0() {
    let out = run(json!([
        { "type": "tool_call", "id": "agent1", "name": "Task", "input": { "description": "work" }, "category": "subagent" },
        { "type": "thinking", "thinking": "before explore", "parentToolUseId": "agent1" },
        { "type": "tool_call", "id": "c1", "name": "Read", "input": { "path": "/a" }, "category": "explore", "parentToolUseId": "agent1" },
        { "type": "tool_call", "id": "c2", "name": "Grep", "input": { "pattern": "x" }, "category": "explore", "parentToolUseId": "agent1" },
    ]));
    assert_eq!(out.len(), 1);
    assert_eq!(out[0]["type"], "task_group");
    let calls = out[0]["calls"].as_array().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(
        calls[0],
        json!({ "type": "thinking", "thinking": "before explore", "parentToolUseId": "agent1" })
    );
    assert_eq!(calls[1]["type"], "tool_group");
    assert_eq!(calls[1]["calls"][0]["id"], "c1");
    assert_eq!(calls[1]["calls"][1]["id"], "c2");
}

#[test]
fn subagent_without_children_emits_an_empty_task_group() {
    // INTENTIONAL DIVERGENCE from the TS source (#507): the TS `groupTaskChildren`
    // collapses a childless Task back to a bare tool_call, but the Rust daemon keeps
    // the empty `_task_group` so the live TaskCard renders before children stream in.
    let out = run(json!([
        { "type": "tool_call", "id": "agent1", "name": "Task", "input": { "description": "solo agent" }, "category": "subagent" },
    ]));
    assert_eq!(out.len(), 1);
    assert_eq!(out[0]["type"], "task_group");
    assert_eq!(out[0]["agentId"], "agent1");
    assert!(out[0]["calls"].as_array().unwrap().is_empty());
}

#[test]
fn task_group_agent_id_comes_from_tool_use_id_not_description() {
    let out = run(json!([
        { "type": "tool_call", "id": "toolu_unique_001", "name": "Task", "input": { "description": "same label", "prompt": "p1" }, "category": "subagent" },
        { "type": "tool_call", "id": "child_001", "name": "Bash", "input": { "command": "echo a" }, "category": "default", "parentToolUseId": "toolu_unique_001" },
    ]));
    assert_eq!(out[0]["type"], "task_group");
    assert_eq!(out[0]["agentId"], "toolu_unique_001");
    assert_ne!(out[0]["agentId"], "same label");
}

// ── 6. hidden tool suppression ──────────────────────────────────────────────
#[test]
fn hidden_tool_between_two_explore_tools_is_suppressed_and_explores_grouped() {
    let out = run(json!([
        { "type": "tool_call", "id": "e1", "name": "Read", "input": { "path": "/a" }, "category": "explore" },
        { "type": "tool_call", "id": "h1", "name": "HiddenTool", "input": {}, "category": "hidden" },
        { "type": "tool_call", "id": "e2", "name": "Grep", "input": { "pattern": "x" }, "category": "explore" },
    ]));
    assert_eq!(out.len(), 1);
    assert_eq!(out[0]["type"], "tool_group");
    assert_eq!(out[0]["calls"].as_array().unwrap().len(), 2);
    assert_eq!(out[0]["calls"][0]["id"], "e1");
    assert_eq!(out[0]["calls"][1]["id"], "e2");
}

// ── 7. realistic mixed sequence ─────────────────────────────────────────────
#[test]
fn text_thinking_explore_x3_default_text_output_order_matches_input() {
    let out = run(json!([
        { "type": "text", "text": "I will analyze the codebase." },
        { "type": "thinking", "thinking": "plan: read 3 files" },
        { "type": "tool_call", "id": "e1", "name": "Read", "input": { "path": "/a.ts" }, "category": "explore" },
        { "type": "tool_call", "id": "e2", "name": "Grep", "input": { "pattern": "import" }, "category": "explore" },
        { "type": "tool_call", "id": "e3", "name": "LS", "input": { "path": "/src" }, "category": "explore" },
        { "type": "tool_call", "id": "d1", "name": "Bash", "input": { "command": "pwd" }, "category": "default" },
        { "type": "text", "text": "Done." },
    ]));
    assert_eq!(out.len(), 5);
    assert_eq!(
        out[0],
        json!({ "type": "text", "text": "I will analyze the codebase." })
    );
    assert_eq!(
        out[1],
        json!({ "type": "thinking", "thinking": "plan: read 3 files" })
    );
    assert_eq!(out[2]["type"], "tool_group");
    assert_eq!(out[2]["calls"].as_array().unwrap().len(), 3);
    assert_eq!(out[2]["calls"][0]["id"], "e1");
    assert_eq!(out[2]["calls"][1]["id"], "e2");
    assert_eq!(out[2]["calls"][2]["id"], "e3");
    assert_eq!(
        out[3],
        json!({ "type": "tool_call", "id": "d1", "name": "Bash", "input": { "command": "pwd" }, "category": "default" })
    );
    assert_eq!(out[4], json!({ "type": "text", "text": "Done." }));
}

#[test]
fn empty_input_returns_empty_output() {
    assert!(run(json!([])).is_empty());
}

#[test]
fn input_with_no_tool_calls_passes_through_unchanged() {
    let input = json!([
        { "type": "text", "text": "Hello" },
        { "type": "thinking", "thinking": "think" },
        { "type": "text", "text": "World" },
    ]);
    let out = run(input.clone());
    assert_eq!(Value::Array(out), input);
}
