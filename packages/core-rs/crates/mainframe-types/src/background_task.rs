use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundTaskStatus {
    Running,
    Completed,
    Failed,
    Stopped,
}

/// What a CLI background task is, mapped from the CLI's `task_type`
/// (`local_bash` → `bash`, agents/teammates → `agent`, …).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundWorkKind {
    Bash,
    Agent,
    Workflow,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BackgroundTaskToolName {
    Bash,
    Monitor,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTaskUsage {
    pub total_tokens: i64,
    pub tool_uses: i64,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTask {
    pub id: String,
    pub kind: BackgroundWorkKind,
    pub tool_name: BackgroundTaskToolName,
    pub tool_use_id: String,
    pub command: String,
    pub description: String,
    pub output_path: Option<String>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub status: BackgroundTaskStatus,
    pub last_output_line: Option<String>,
    pub summary: Option<String>,
    pub usage: Option<BackgroundTaskUsage>,
    /// True when this entry was rehydrated by reconciliation, not produced by a
    /// live CLI session. Optional; the TS type only ever holds `true`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovered: Option<bool>,
    /// Set when this task is a Claude CLI workflow launch. `run_id` starts
    /// `None` and is learned later from the `Workflow` tool result.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BackgroundTaskEvent {
    #[serde(rename = "background_task.started", rename_all = "camelCase")]
    Started {
        chat_id: String,
        task: BackgroundTask,
    },
    #[serde(rename = "background_task.updated", rename_all = "camelCase")]
    Updated {
        chat_id: String,
        task: BackgroundTask,
    },
    #[serde(rename = "background_task.ended", rename_all = "camelCase")]
    Ended {
        chat_id: String,
        task: BackgroundTask,
    },
}

/// One live background task as surfaced to clients (in `Chat.backgroundActivity`
/// and the UI activity bar).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundActivityTask {
    pub id: String,
    pub kind: BackgroundWorkKind,
    pub description: String,
    pub started_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

/// Live background work for a chat — derived from the tracker, never persisted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundActivity {
    pub total: u32,
    /// `Partial<Record<BackgroundWorkKind, number>>` — only positive counts.
    pub by_kind: HashMap<BackgroundWorkKind, u32>,
    pub tasks: Vec<BackgroundActivityTask>,
}

/// Project a tracker task onto its client-facing activity entry (bash tasks often
/// carry the command, not a description).
pub fn to_activity_task(task: &BackgroundTask) -> BackgroundActivityTask {
    BackgroundActivityTask {
        id: task.id.clone(),
        kind: task.kind,
        description: if task.description.is_empty() {
            task.command.clone()
        } else {
            task.description.clone()
        },
        started_at: task.started_at,
        workflow_name: task.workflow_name.clone(),
        run_id: task.run_id.clone(),
    }
}

/// Aggregate live tasks into the `backgroundActivity` payload; `None` when nothing
/// is live.
pub fn derive_background_activity(tasks: &[BackgroundActivityTask]) -> Option<BackgroundActivity> {
    if tasks.is_empty() {
        return None;
    }
    let mut by_kind: HashMap<BackgroundWorkKind, u32> = HashMap::new();
    for task in tasks {
        *by_kind.entry(task.kind).or_insert(0) += 1;
    }
    Some(BackgroundActivity {
        total: tasks.len() as u32,
        by_kind,
        tasks: tasks.to_vec(),
    })
}

#[cfg(test)]
#[path = "background_task_tests.rs"]
mod tests;
