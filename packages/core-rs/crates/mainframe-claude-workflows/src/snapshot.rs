//! Parses a `task_progress.workflow_progress` cumulative snapshot array into
//! the phases/agents the store retains. See the wire contract's `snapshot.rs`
//! section in the plan.

use mainframe_types::claude_workflow::{ClaudeWorkflowAgent, ClaudeWorkflowPhase};
use serde_json::Value;

/// The parsed structure of one `workflow_progress` snapshot.
pub struct ParsedSnapshot {
    pub phases: Vec<ClaudeWorkflowPhase>,
    pub agents: Vec<ClaudeWorkflowAgent>,
}

/// Discriminates `workflow_phase` / `workflow_agent` / `workflow_log` entries;
/// anything else is ignored. Phases sort by `index`, agents by
/// `(phase_index, index)`.
pub fn parse_snapshot(_entries: &[Value]) -> ParsedSnapshot {
    unimplemented!("wf-core")
}
