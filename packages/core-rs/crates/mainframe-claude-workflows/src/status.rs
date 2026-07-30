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
pub fn task_update_action(_status: &str) -> TaskUpdateAction {
    unimplemented!("wf-core")
}

/// `task_notification` path: same table, but `Ignore` collapses to `Stopped`
/// (a notification is terminal by definition).
pub fn terminal_task_status(_status: &str) -> BackgroundTaskStatus {
    unimplemented!("wf-core")
}

/// What a `task_updated`/record status means to the workflow-run store.
/// `None` means the run is left untouched (an unrecognized status).
pub fn run_status(_status: &str) -> Option<ClaudeWorkflowRunStatus> {
    unimplemented!("wf-core")
}
