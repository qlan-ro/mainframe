//! Parses a `task_progress.workflow_progress` cumulative snapshot array into
//! the phases/agents the store retains. See the wire contract's `snapshot.rs`
//! section in the plan.

use mainframe_types::claude_workflow::{
    ClaudeWorkflowAgent, ClaudeWorkflowAgentState, ClaudeWorkflowPhase,
};
use serde_json::Value;

/// The parsed structure of one `workflow_progress` snapshot.
pub struct ParsedSnapshot {
    pub phases: Vec<ClaudeWorkflowPhase>,
    pub agents: Vec<ClaudeWorkflowAgent>,
}

/// Discriminates `workflow_phase` / `workflow_agent` / `workflow_log` entries;
/// anything else is ignored. Phases sort by `index`, agents by
/// `(phase_index, index)`.
pub fn parse_snapshot(entries: &[Value]) -> ParsedSnapshot {
    let mut phases = Vec::new();
    let mut agents = Vec::new();

    for entry in entries {
        match entry.get("type").and_then(Value::as_str) {
            Some("workflow_phase") => phases.push(parse_phase(entry)),
            Some("workflow_agent") => agents.push(parse_agent(entry)),
            _ => {}
        }
    }

    phases.sort_by_key(|phase| phase.index);
    agents.sort_by_key(|agent| (agent.phase_index, agent.index));

    ParsedSnapshot { phases, agents }
}

fn parse_phase(entry: &Value) -> ClaudeWorkflowPhase {
    ClaudeWorkflowPhase {
        index: entry.get("index").and_then(Value::as_i64).unwrap_or(0),
        title: entry
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        kind: entry
            .get("kind")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

fn parse_agent(entry: &Value) -> ClaudeWorkflowAgent {
    ClaudeWorkflowAgent {
        agent_id: entry
            .get("agentId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        index: entry.get("index").and_then(Value::as_i64).unwrap_or(0),
        phase_index: entry.get("phaseIndex").and_then(Value::as_i64).unwrap_or(0),
        label: entry
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        state: parse_agent_state(entry.get("state").and_then(Value::as_str)),
        model: entry
            .get("model")
            .and_then(Value::as_str)
            .map(str::to_string),
        attempt: entry.get("attempt").and_then(Value::as_i64),
        tokens: entry.get("tokens").and_then(Value::as_i64).unwrap_or(0),
        tool_calls: entry.get("toolCalls").and_then(Value::as_i64).unwrap_or(0),
        duration_ms: entry.get("durationMs").and_then(Value::as_i64).unwrap_or(0),
        error: entry
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string),
        result_preview: entry
            .get("resultPreview")
            .and_then(Value::as_str)
            .map(str::to_string),
        last_tool_name: entry
            .get("lastToolName")
            .and_then(Value::as_str)
            .map(str::to_string),
        last_tool_summary: entry
            .get("lastToolSummary")
            .and_then(Value::as_str)
            .map(str::to_string),
        last_progress_at: entry.get("lastProgressAt").and_then(Value::as_i64),
    }
}

fn parse_agent_state(state: Option<&str>) -> ClaudeWorkflowAgentState {
    match state {
        Some("start") => ClaudeWorkflowAgentState::Start,
        Some("progress") => ClaudeWorkflowAgentState::Progress,
        Some("done") => ClaudeWorkflowAgentState::Done,
        Some("error") => ClaudeWorkflowAgentState::Error,
        _ => ClaudeWorkflowAgentState::Unknown,
    }
}
