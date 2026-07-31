//! Red-phase (Task 6): `snapshot::parse_snapshot` over a `workflow_progress`
//! cumulative array. Turned green by Task 12.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use mainframe_claude_workflows::snapshot::parse_snapshot;
use mainframe_types::claude_workflow::ClaudeWorkflowAgentState;
use serde_json::Value;

fn fixture() -> Vec<Value> {
    let raw = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/workflow_progress_snapshot.json"
    ))
    .unwrap();
    serde_json::from_str(&raw).unwrap()
}

#[test]
fn phases_become_claude_workflow_phase_in_index_order() {
    let parsed = parse_snapshot(&fixture());
    assert_eq!(parsed.phases.len(), 2);
    assert_eq!(parsed.phases[0].index, 0);
    assert_eq!(parsed.phases[0].title, "Plan");
    assert_eq!(parsed.phases[0].kind.as_deref(), Some("planning"));
    assert_eq!(parsed.phases[1].index, 1);
    assert_eq!(parsed.phases[1].title, "Implement");
}

#[test]
fn agents_map_every_consumed_field() {
    let parsed = parse_snapshot(&fixture());
    assert_eq!(parsed.agents.len(), 2);

    let alpha = &parsed.agents[0];
    assert_eq!(alpha.agent_id, "agent-alpha");
    assert_eq!(alpha.index, 0);
    assert_eq!(alpha.phase_index, 0);
    assert_eq!(alpha.label, "core-dev");
    assert_eq!(alpha.state, ClaudeWorkflowAgentState::Start);
    assert_eq!(alpha.model.as_deref(), Some("claude-sonnet-5"));
    assert_eq!(alpha.attempt, Some(1));
    assert_eq!(alpha.tokens, 1200);
    assert_eq!(alpha.tool_calls, 3);
    assert_eq!(alpha.duration_ms, 5000);
    assert_eq!(alpha.error, None);
    assert_eq!(alpha.result_preview, None);
    assert_eq!(alpha.last_tool_name.as_deref(), Some("Read"));
    assert_eq!(alpha.last_tool_summary.as_deref(), Some("Read plan.md"));
    assert_eq!(alpha.last_progress_at, Some(1700000005000));

    let beta = &parsed.agents[1];
    assert_eq!(beta.agent_id, "agent-beta");
    assert_eq!(beta.phase_index, 1);
    assert_eq!(beta.state, ClaudeWorkflowAgentState::Error);
    assert_eq!(beta.error.as_deref(), Some("reviewer timed out"));
    assert_eq!(beta.result_preview.as_deref(), Some("partial notes"));
}

#[test]
fn workflow_log_entries_produce_neither_a_phase_nor_an_agent() {
    let entries: Vec<Value> = vec![serde_json::json!({
        "type": "workflow_log",
        "index": 0,
        "line": "[plan] started"
    })];
    let parsed = parse_snapshot(&entries);
    assert!(parsed.phases.is_empty());
    assert!(parsed.agents.is_empty());
}

#[test]
fn unknown_entry_type_is_ignored_and_unknown_agent_state_maps_to_unknown() {
    let entries: Vec<Value> = vec![
        serde_json::json!({ "type": "workflow_mystery", "index": 0 }),
        serde_json::json!({
            "type": "workflow_agent",
            "index": 0,
            "label": "mystery-agent",
            "phaseIndex": 0,
            "agentId": "agent-mystery",
            "state": "sleeping",
            "tokens": 0,
            "toolCalls": 0,
            "durationMs": 0
        }),
    ];
    let parsed = parse_snapshot(&entries);
    assert!(parsed.phases.is_empty());
    assert_eq!(parsed.agents.len(), 1);
    assert_eq!(parsed.agents[0].state, ClaudeWorkflowAgentState::Unknown);
}

#[test]
fn empty_entry_array_yields_empty_phases_and_agents_without_panicking() {
    let parsed = parse_snapshot(&[]);
    assert!(parsed.phases.is_empty());
    assert!(parsed.agents.is_empty());
}
