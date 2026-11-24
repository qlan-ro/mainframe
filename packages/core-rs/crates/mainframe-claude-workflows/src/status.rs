//! Maps the CLI's task `status` string onto what the background-task tracker
//! and the workflow-run store each do with it. The string is parsed once into
//! [`CliTaskStatus`]; the two consumers then map that enum their own way,
//! because they disagree on `paused` (the tracker ends the task, the run store
//! keeps the run resumable) and on an unknown status (the tracker ends the task,
//! the run store leaves the run alone).

use mainframe_types::background_task::BackgroundTaskStatus;
use mainframe_types::claude_workflow::ClaudeWorkflowRunStatus;

/// The task statuses the Claude CLI reports on `task_updated`,
/// `task_notification` and in a `wf_<runId>.json` record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CliTaskStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Killed,
    Paused,
    Stopped,
}

impl CliTaskStatus {
    fn parse(status: &str) -> Option<Self> {
        Some(match status {
            "pending" => Self::Pending,
            "running" => Self::Running,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "killed" => Self::Killed,
            "paused" => Self::Paused,
            "stopped" => Self::Stopped,
            _ => return None,
        })
    }
}

/// What a `task_updated` status means to the `BackgroundTaskTracker`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskUpdateAction {
    Ignore,
    End(BackgroundTaskStatus),
}

/// `task_updated` path: `pending`/`running` are ignored, terminal statuses end
/// the tracker task, and an unknown status ends it as `Stopped` with a warning.
pub fn task_update_action(status: &str) -> TaskUpdateAction {
    let Some(parsed) = CliTaskStatus::parse(status) else {
        tracing::warn!(status, "unknown claude workflow task status");
        return TaskUpdateAction::End(BackgroundTaskStatus::Stopped);
    };
    match parsed {
        CliTaskStatus::Pending | CliTaskStatus::Running => TaskUpdateAction::Ignore,
        CliTaskStatus::Completed => TaskUpdateAction::End(BackgroundTaskStatus::Completed),
        CliTaskStatus::Failed => TaskUpdateAction::End(BackgroundTaskStatus::Failed),
        CliTaskStatus::Killed | CliTaskStatus::Paused | CliTaskStatus::Stopped => {
            TaskUpdateAction::End(BackgroundTaskStatus::Stopped)
        }
    }
}

/// `task_notification` path: the same mapping, but `Ignore` collapses to
/// `Stopped` because a notification is terminal by definition.
pub fn terminal_task_status(status: &str) -> BackgroundTaskStatus {
    match task_update_action(status) {
        TaskUpdateAction::Ignore => BackgroundTaskStatus::Stopped,
        TaskUpdateAction::End(status) => status,
    }
}

/// What a `task_updated` or record status means to the workflow-run store.
/// `None` for an unrecognized status, which leaves the run untouched.
pub fn run_status(status: &str) -> Option<ClaudeWorkflowRunStatus> {
    Some(match CliTaskStatus::parse(status)? {
        CliTaskStatus::Pending | CliTaskStatus::Running => ClaudeWorkflowRunStatus::Running,
        CliTaskStatus::Completed => ClaudeWorkflowRunStatus::Completed,
        CliTaskStatus::Failed => ClaudeWorkflowRunStatus::Failed,
        CliTaskStatus::Killed | CliTaskStatus::Stopped => ClaudeWorkflowRunStatus::Stopped,
        CliTaskStatus::Paused => ClaudeWorkflowRunStatus::Paused,
    })
}
