//! Parses a `task_progress.workflow_progress` cumulative snapshot array into
//! the phases/agents the store retains.

use mainframe_types::claude_workflow::{
    ClaudeWorkflowAgent, ClaudeWorkflowAgentState, ClaudeWorkflowPhase,
};
use serde_json::Value;

use crate::fields::{i64_or_zero, opt_i64, opt_str, str_or_empty};

/// The parsed structure of one `workflow_progress` snapshot.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedSnapshot {
    pub phases: Vec<ClaudeWorkflowPhase>,
    pub agents: Vec<ClaudeWorkflowAgent>,
}

impl ParsedSnapshot {
    /// Whether the snapshot named at least one phase or agent.
    pub fn has_structure(&self) -> bool {
        !self.phases.is_empty() || !self.agents.is_empty()
    }
}

/// Keeps `workflow_phase` and `workflow_agent` entries and ignores every other
/// type (`workflow_log` included). Phases sort by `index`, agents by
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
        index: i64_or_zero(entry, "index"),
        title: str_or_empty(entry, "title"),
        kind: opt_str(entry, "kind"),
    }
}

fn parse_agent(entry: &Value) -> ClaudeWorkflowAgent {
    ClaudeWorkflowAgent {
        agent_id: str_or_empty(entry, "agentId"),
        index: i64_or_zero(entry, "index"),
        phase_index: i64_or_zero(entry, "phaseIndex"),
        label: str_or_empty(entry, "label"),
        state: parse_agent_state(entry.get("state").and_then(Value::as_str)),
        model: opt_str(entry, "model"),
        attempt: opt_i64(entry, "attempt"),
        tokens: i64_or_zero(entry, "tokens"),
        tool_calls: i64_or_zero(entry, "toolCalls"),
        duration_ms: i64_or_zero(entry, "durationMs"),
        error: opt_str(entry, "error"),
        result_preview: opt_str(entry, "resultPreview"),
        last_tool_name: opt_str(entry, "lastToolName"),
        last_tool_summary: opt_str(entry, "lastToolSummary"),
        last_progress_at: opt_i64(entry, "lastProgressAt"),
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
