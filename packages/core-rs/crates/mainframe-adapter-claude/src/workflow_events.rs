//! Bridges the Claude CLI's workflow-carrying system events and the
//! `Workflow` tool result into `mainframe-claude-workflows`. Kept as a
//! sibling of `task_events.rs` rather than folded into it because its three
//! state-bound helpers below take a borrowed `&ClaudeSessionState` and must
//! never lock it: `events.rs` and `user_event.rs` call them while already
//! holding the non-reentrant state mutex.

use std::path::PathBuf;

use serde_json::Value;

use mainframe_claude_workflows::reconcile::RecordLocation;
use mainframe_claude_workflows::store::ProgressUsage;

use crate::session::ClaudeSessionState;

/// The `task_updated` fields `task_events::handle_task_updated` consumes.
pub struct TaskUpdatedPayload {
    pub task_id: String,
    pub status: String,
}

/// Reads `task_id` from the top level and `status` from `patch` only — the CLI
/// never puts a current status at the top level for this event, so there is no
/// top-level fallback to prefer over `patch`.
pub fn task_updated_payload(event: &Value) -> TaskUpdatedPayload {
    let task_id = event
        .get("task_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let status = event
        .get("patch")
        .and_then(|p| p.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    TaskUpdatedPayload { task_id, status }
}

/// The identity learned from a `Workflow` tool result (`type:
/// "async_launched"`).
pub struct LaunchResult {
    pub task_id: String,
    pub run_id: String,
    pub workflow_name: Option<String>,
}

/// Parses a `Workflow` tool result. `None` for non-JSON text or a JSON object
/// missing `runId` — the run id is the one field the store cannot do without.
pub fn parse_launch_result(text: &str) -> Option<LaunchResult> {
    let value: Value = serde_json::from_str(text).ok()?;
    let task_id = value.get("taskId").and_then(Value::as_str)?.to_string();
    let run_id = value.get("runId").and_then(Value::as_str)?.to_string();
    let workflow_name = value
        .get("workflowName")
        .and_then(Value::as_str)
        .map(str::to_string);
    Some(LaunchResult {
        task_id,
        run_id,
        workflow_name,
    })
}

/// `task_progress`: forwards cumulative usage, and an optional structure
/// snapshot, to the workflow store — through `state.task_events`, never by
/// locking `state` itself (the caller already holds that lock).
pub(crate) fn handle_task_progress(state: &ClaudeSessionState, event: &Value) {
    if state.mainframe_chat_id.is_empty() {
        return;
    }
    let Some(task_id) = event.get("task_id").and_then(Value::as_str) else {
        return;
    };
    let usage = event.get("usage");
    let total_tokens = usage
        .and_then(|u| u.get("total_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let duration_ms = usage
        .and_then(|u| u.get("duration_ms"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let snapshot: Option<&[Value]> = event
        .get("workflow_progress")
        .and_then(Value::as_array)
        .map(Vec::as_slice);

    state.task_events.apply_workflow_progress(
        &state.mainframe_chat_id,
        task_id,
        ProgressUsage {
            total_tokens,
            duration_ms,
        },
        snapshot,
    );
}

/// Where the CLI writes this chat's workflow run records. `None` when the
/// session hasn't been assigned a CLI session id yet — there is nothing on
/// disk to read.
pub(crate) fn record_location(state: &ClaudeSessionState) -> Option<RecordLocation> {
    if state.chat_id.is_empty() {
        return None;
    }
    let paths = crate::transcript::get_session_jsonl_path(&state.chat_id, &state.real_project_path);
    Some(RecordLocation {
        project_dir: PathBuf::from(paths.project_dir),
        session_id: state.chat_id.clone(),
    })
}

/// Learned from the `Workflow` tool result. Delegates to `ClaudeTaskEvents`,
/// which updates the tracker and the workflow store through their own
/// interior synchronization — this is the only place the workflow crate and
/// the adapter's path logic meet, so `mainframe-claude-workflows` stays free
/// of an adapter dependency.
pub(crate) fn link_launch(state: &ClaudeSessionState, text: &str) {
    if state.mainframe_chat_id.is_empty() {
        return;
    }
    let Some(result) = parse_launch_result(text) else {
        return;
    };
    state.task_events.link_run_id(
        &state.mainframe_chat_id,
        &result.task_id,
        &result.run_id,
        result.workflow_name,
    );
}
