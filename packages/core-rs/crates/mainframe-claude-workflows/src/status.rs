//! CLI `patch.status` → tracker action / run status mapping. See the plan's
//! *Status mapping tables* — the same table backs three call sites: the
//! background-task tracker (`task_update_action`, `terminal_task_status`) and
//! the workflow-run store (`run_status`).

use mainframe_types::background_task::BackgroundTaskStatus;
use mainframe_types::claude_workflow::ClaudeWorkflowRunStatus;

/// What a `task_updated` status means to the `BackgroundTaskTracker`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskUpdateAction {
    Ignore,
    End(BackgroundTaskStatus),
}

/// `task_updated` path: `pending`/`running` are ignored, terminal statuses end
/// the tracker task, and an unknown status ends it as `Stopped` with a warning.
pub fn task_update_action(status: &str) -> TaskUpdateAction {
    match status {
        "pending" | "running" => TaskUpdateAction::Ignore,
        "completed" => TaskUpdateAction::End(BackgroundTaskStatus::Completed),
        "failed" => TaskUpdateAction::End(BackgroundTaskStatus::Failed),
        "killed" => TaskUpdateAction::End(BackgroundTaskStatus::Stopped),
        "paused" | "stopped" => TaskUpdateAction::End(BackgroundTaskStatus::Stopped),
        other => {
            tracing::warn!(status = %other, "unknown claude workflow task status");
            TaskUpdateAction::End(BackgroundTaskStatus::Stopped)
        }
    }
}

/// `task_notification` path: same table, but `Ignore` collapses to `Stopped`
/// (a notification is terminal by definition).
pub fn terminal_task_status(status: &str) -> BackgroundTaskStatus {
    match task_update_action(status) {
        TaskUpdateAction::Ignore => BackgroundTaskStatus::Stopped,
        TaskUpdateAction::End(status) => status,
    }
}

/// What a `task_updated`/record status means to the workflow-run store.
/// `None` means the run is left untouched (an unrecognized status).
pub fn run_status(status: &str) -> Option<ClaudeWorkflowRunStatus> {
    match status {
        "pending" | "running" => Some(ClaudeWorkflowRunStatus::Running),
        "completed" => Some(ClaudeWorkflowRunStatus::Completed),
        "failed" => Some(ClaudeWorkflowRunStatus::Failed),
        "killed" | "stopped" => Some(ClaudeWorkflowRunStatus::Stopped),
        "paused" => Some(ClaudeWorkflowRunStatus::Paused),
        _ => None,
    }
}
