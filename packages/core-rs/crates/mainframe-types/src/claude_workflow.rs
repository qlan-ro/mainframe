//! Ported from `packages/types/src/claude-workflow.ts`.
//!
//! Wire types for a Claude CLI workflow run (`/workflows` scripts), assembled
//! from `task_progress`/`task_updated` system events and the on-disk
//! `wf_<runId>.json` record. Prefixed `ClaudeWorkflow*` to stay distinct from
//! the unrelated Automations `Workflow*` types in `workflow.rs`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeWorkflowRunStatus {
    Running,
    Completed,
    Failed,
    Stopped,
    Paused,
    Unavailable,
}

impl ClaudeWorkflowRunStatus {
    /// `Paused` is deliberately excluded: its duration is frozen, but a resume
    /// from the CLI's own TUI may still move it, so it is not final.
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            ClaudeWorkflowRunStatus::Completed
                | ClaudeWorkflowRunStatus::Failed
                | ClaudeWorkflowRunStatus::Stopped
                | ClaudeWorkflowRunStatus::Unavailable
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeWorkflowAgentState {
    Start,
    Progress,
    Done,
    Error,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeWorkflowRunSource {
    Launch,
    Snapshot,
    Record,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeWorkflowPhase {
    pub index: i64,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeWorkflowAgent {
    pub agent_id: String,
    pub index: i64,
    pub phase_index: i64,
    pub label: String,
    pub state: ClaudeWorkflowAgentState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt: Option<i64>,
    pub tokens: i64,
    pub tool_calls: i64,
    pub duration_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_tool_summary: Option<String>,
    /// ms epoch.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_progress_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeWorkflowRun {
    /// Canonical key (A1) — the CLI's `task_progress`/`task_updated` `task_id`.
    pub task_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_name: Option<String>,
    pub status: ClaudeWorkflowRunStatus,
    pub source: ClaudeWorkflowRunSource,
    pub total_tokens: i64,
    pub duration_ms: i64,
    /// `usage.duration_ms` of the last accepted snapshot.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structure_revision: Option<i64>,
    /// ms epoch the run went terminal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_at: Option<i64>,
    pub phases: Vec<ClaudeWorkflowPhase>,
    pub agents: Vec<ClaudeWorkflowAgent>,
}

impl ClaudeWorkflowRun {
    /// The initial run recorded from `task_started` — before a `run_id` is
    /// learned from the `Workflow` tool result or any snapshot has arrived.
    pub fn new_seed(task_id: &str, workflow_name: Option<String>) -> Self {
        ClaudeWorkflowRun {
            task_id: task_id.to_string(),
            run_id: None,
            workflow_name,
            status: ClaudeWorkflowRunStatus::Running,
            source: ClaudeWorkflowRunSource::Launch,
            total_tokens: 0,
            duration_ms: 0,
            structure_revision: None,
            terminal_at: None,
            phases: Vec::new(),
            agents: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_terminal_matches_completed_failed_stopped_unavailable() {
        for status in [
            ClaudeWorkflowRunStatus::Completed,
            ClaudeWorkflowRunStatus::Failed,
            ClaudeWorkflowRunStatus::Stopped,
            ClaudeWorkflowRunStatus::Unavailable,
        ] {
            assert!(status.is_terminal());
        }
    }

    #[test]
    fn is_terminal_excludes_running_and_paused() {
        assert!(!ClaudeWorkflowRunStatus::Running.is_terminal());
        assert!(!ClaudeWorkflowRunStatus::Paused.is_terminal());
    }

    #[test]
    fn new_seed_produces_a_running_launch_sourced_run() {
        let run = ClaudeWorkflowRun::new_seed("task_1", Some("deploy".to_string()));
        assert_eq!(run.task_id, "task_1");
        assert_eq!(run.run_id, None);
        assert_eq!(run.workflow_name, Some("deploy".to_string()));
        assert_eq!(run.status, ClaudeWorkflowRunStatus::Running);
        assert_eq!(run.source, ClaudeWorkflowRunSource::Launch);
        assert_eq!(run.total_tokens, 0);
        assert_eq!(run.duration_ms, 0);
        assert_eq!(run.structure_revision, None);
        assert_eq!(run.terminal_at, None);
        assert!(run.phases.is_empty());
        assert!(run.agents.is_empty());
    }

    #[test]
    fn run_status_round_trips_through_json_as_camel_case() {
        let run = ClaudeWorkflowRun::new_seed("task_1", None);
        let json = serde_json::to_value(&run).unwrap();
        assert_eq!(json["taskId"], "task_1");
        assert_eq!(json["status"], "running");
        assert_eq!(json["source"], "launch");
        assert!(json.get("runId").is_none());
        assert!(json.get("workflowName").is_none());
    }
}
