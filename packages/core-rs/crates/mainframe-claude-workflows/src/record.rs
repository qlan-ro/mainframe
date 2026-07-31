//! Reads completed-run records off disk:
//! `<claude project dir>/<sessionId>/workflows/wf_<runId>.json`. A directory
//! that does not exist means the run was interrupted before it could write
//! one — the normal case, not an error (todo constraint 8).

use std::path::{Path, PathBuf};

use mainframe_types::claude_workflow::{
    ClaudeWorkflowRun, ClaudeWorkflowRunSource, ClaudeWorkflowRunStatus,
};
use serde_json::Value;

use crate::snapshot::{ParsedSnapshot, parse_snapshot};
use crate::status::run_status;

/// `<project_dir>/<session_id>/workflows`.
pub fn workflows_dir(project_dir: &Path, session_id: &str) -> PathBuf {
    project_dir.join(session_id).join("workflows")
}

/// Maps one `wf_<runId>.json` record into a `Record`-sourced
/// `ClaudeWorkflowRun`. Returns `None` for a malformed (non-object) record.
pub fn parse_run_record(value: &Value) -> Option<ClaudeWorkflowRun> {
    let object = value.as_object()?;
    let task_id = object.get("taskId")?.as_str()?.to_string();
    let duration_ms = object
        .get("durationMs")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let workflow_progress = object.get("workflowProgress").and_then(Value::as_array);
    let parsed = workflow_progress.map(|entries| parse_snapshot(entries));

    Some(ClaudeWorkflowRun {
        task_id,
        run_id: object
            .get("runId")
            .and_then(Value::as_str)
            .map(str::to_string),
        workflow_name: object
            .get("workflowName")
            .and_then(Value::as_str)
            .map(str::to_string),
        status: record_status(
            object.get("status").and_then(Value::as_str),
            parsed.as_ref(),
        ),
        source: ClaudeWorkflowRunSource::Record,
        total_tokens: object
            .get("totalTokens")
            .and_then(Value::as_i64)
            .unwrap_or(0),
        duration_ms,
        structure_revision: parsed.is_some().then_some(duration_ms),
        terminal_at: None,
        phases: parsed
            .as_ref()
            .map(|p| p.phases.clone())
            .unwrap_or_default(),
        agents: parsed.map(|p| p.agents).unwrap_or_default(),
    })
}

/// D15 reserves `Unavailable` for a record with no recoverable structure, so an
/// unrecognized or absent status downgrades a record only when it also parsed
/// nothing. With structure in hand the run is finished but unclassifiable —
/// `Stopped`, the same landing spot `status::task_update_action` gives the
/// tracker for an unknown status.
fn record_status(raw: Option<&str>, parsed: Option<&ParsedSnapshot>) -> ClaudeWorkflowRunStatus {
    if let Some(status) = raw.and_then(run_status) {
        return status;
    }
    let has_structure = parsed.is_some_and(|p| !p.phases.is_empty() || !p.agents.is_empty());
    if has_structure {
        ClaudeWorkflowRunStatus::Stopped
    } else {
        ClaudeWorkflowRunStatus::Unavailable
    }
}

/// Reads every `wf_*.json` file in the session's `workflows/` directory.
/// Returns an empty vec (not an error) when the directory is absent.
pub async fn read_run_records(project_dir: &Path, session_id: &str) -> Vec<ClaudeWorkflowRun> {
    let dir = workflows_dir(project_dir, session_id);
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(err) => {
            tracing::debug!(path = %dir.display(), error = %err, "workflows dir not readable");
            return Vec::new();
        }
    };

    let mut runs = Vec::new();
    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => break,
            Err(err) => {
                tracing::warn!(path = %dir.display(), error = %err, "failed to read workflows dir entry");
                break;
            }
        };
        let Some(run) = read_run_record_file(&entry.path()).await else {
            continue;
        };
        runs.push(run);
    }
    runs
}

async fn read_run_record_file(path: &Path) -> Option<ClaudeWorkflowRun> {
    let name = path.file_name()?.to_str()?;
    if !name.starts_with("wf_") || !name.ends_with(".json") {
        return None;
    }

    let contents = match tokio::fs::read_to_string(path).await {
        Ok(contents) => contents,
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "failed to read workflow run record");
            return None;
        }
    };

    match serde_json::from_str::<Value>(&contents) {
        Ok(value) => parse_run_record(&value),
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "failed to parse workflow run record");
            None
        }
    }
}
