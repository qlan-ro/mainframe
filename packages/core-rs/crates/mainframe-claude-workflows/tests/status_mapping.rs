//! Red-phase (Task 7): the CLI `patch.status` -> tracker action / run status
//! table from the plan's *Status mapping tables*. Turned green by Task 13.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use mainframe_claude_workflows::status::{
    TaskUpdateAction, run_status, task_update_action, terminal_task_status,
};
use mainframe_types::background_task::BackgroundTaskStatus;
use mainframe_types::claude_workflow::ClaudeWorkflowRunStatus;

#[test]
fn task_update_action_ignores_pending_and_running() {
    assert_eq!(task_update_action("pending"), TaskUpdateAction::Ignore);
    assert_eq!(task_update_action("running"), TaskUpdateAction::Ignore);
}

#[test]
fn task_update_action_ends_completed_failed_and_killed() {
    assert_eq!(
        task_update_action("completed"),
        TaskUpdateAction::End(BackgroundTaskStatus::Completed)
    );
    assert_eq!(
        task_update_action("failed"),
        TaskUpdateAction::End(BackgroundTaskStatus::Failed)
    );
    assert_eq!(
        task_update_action("killed"),
        TaskUpdateAction::End(BackgroundTaskStatus::Stopped)
    );
}

#[test]
fn task_update_action_ends_paused_and_stopped_as_stopped() {
    assert_eq!(
        task_update_action("paused"),
        TaskUpdateAction::End(BackgroundTaskStatus::Stopped)
    );
    assert_eq!(
        task_update_action("stopped"),
        TaskUpdateAction::End(BackgroundTaskStatus::Stopped)
    );
}

#[test]
fn task_update_action_ends_unknown_status_as_stopped() {
    assert_eq!(
        task_update_action("nonsense"),
        TaskUpdateAction::End(BackgroundTaskStatus::Stopped)
    );
}

#[test]
fn terminal_task_status_collapses_ignore_rows_to_stopped() {
    assert_eq!(
        terminal_task_status("pending"),
        BackgroundTaskStatus::Stopped
    );
    assert_eq!(
        terminal_task_status("running"),
        BackgroundTaskStatus::Stopped
    );
}

#[test]
fn terminal_task_status_matches_the_same_table_for_end_rows() {
    assert_eq!(
        terminal_task_status("completed"),
        BackgroundTaskStatus::Completed
    );
    assert_eq!(terminal_task_status("failed"), BackgroundTaskStatus::Failed);
    assert_eq!(
        terminal_task_status("killed"),
        BackgroundTaskStatus::Stopped
    );
    assert_eq!(
        terminal_task_status("paused"),
        BackgroundTaskStatus::Stopped
    );
    assert_eq!(
        terminal_task_status("stopped"),
        BackgroundTaskStatus::Stopped
    );
    assert_eq!(
        terminal_task_status("nonsense"),
        BackgroundTaskStatus::Stopped
    );
}

#[test]
fn run_status_maps_pending_and_running_to_running() {
    assert_eq!(
        run_status("pending"),
        Some(ClaudeWorkflowRunStatus::Running)
    );
    assert_eq!(
        run_status("running"),
        Some(ClaudeWorkflowRunStatus::Running)
    );
}

#[test]
fn run_status_maps_completed_failed_and_killed() {
    assert_eq!(
        run_status("completed"),
        Some(ClaudeWorkflowRunStatus::Completed)
    );
    assert_eq!(run_status("failed"), Some(ClaudeWorkflowRunStatus::Failed));
    assert_eq!(run_status("killed"), Some(ClaudeWorkflowRunStatus::Stopped));
}

#[test]
fn run_status_maps_paused_distinctly_from_stopped_while_the_tracker_still_ends_it() {
    assert_eq!(run_status("paused"), Some(ClaudeWorkflowRunStatus::Paused));
    assert_eq!(
        run_status("stopped"),
        Some(ClaudeWorkflowRunStatus::Stopped)
    );
    assert_eq!(
        task_update_action("paused"),
        TaskUpdateAction::End(BackgroundTaskStatus::Stopped)
    );
}

#[test]
fn run_status_returns_none_for_an_unrecognized_status() {
    assert_eq!(run_status("nonsense"), None);
}
