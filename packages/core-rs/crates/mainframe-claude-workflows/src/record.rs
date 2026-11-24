//! Reads completed-run records off disk:
//! `<claude project dir>/<sessionId>/workflows/wf_<runId>.json`. A missing
//! directory means the run was interrupted before it wrote one. That is the
//! normal case, not an error.

use std::path::{Path, PathBuf};

use mainframe_types::claude_workflow::{
    ClaudeWorkflowRun, ClaudeWorkflowRunSource, ClaudeWorkflowRunStatus,
};
use serde_json::Value;

use crate::fields::{i64_or_zero, opt_str};
use crate::snapshot::{ParsedSnapshot, parse_snapshot};
use crate::status::run_status;

/// `<project_dir>/<session_id>/workflows`.
pub fn workflows_dir(project_dir: &Path, session_id: &str) -> PathBuf {
    project_dir.join(session_id).join("workflows")
}

/// Maps one `wf_<runId>.json` record into a `Record`-sourced
/// `ClaudeWorkflowRun`. Returns `None` when the record is not an object or has
/// no string `taskId`, the key every run is stored under.
pub fn parse_run_record(value: &Value) -> Option<ClaudeWorkflowRun> {
    let task_id = value.as_object()?.get("taskId")?.as_str()?.to_string();
    let duration_ms = i64_or_zero(value, "durationMs");
    let parsed = value
        .get("workflowProgress")
        .and_then(Value::as_array)
        .map(|entries| parse_snapshot(entries));
    let status = record_status(value.get("status").and_then(Value::as_str), parsed.as_ref());
    let structure_revision = parsed.is_some().then_some(duration_ms);
    let ParsedSnapshot { phases, agents } = parsed.unwrap_or_default();

    Some(ClaudeWorkflowRun {
        task_id,
        run_id: opt_str(value, "runId"),
        workflow_name: opt_str(value, "workflowName"),
        status,
        source: ClaudeWorkflowRunSource::Record,
        total_tokens: i64_or_zero(value, "totalTokens"),
        duration_ms,
        structure_revision,
        terminal_at: None,
        phases,
        agents,
    })
}

/// `Unavailable` is reserved for a record with no recoverable structure, so an
/// unrecognized or absent status downgrades a record only when it also parsed
/// nothing. With structure in hand the run is finished but unclassifiable:
/// `Stopped`, where `status::task_update_action` also puts an unknown status.
fn record_status(raw: Option<&str>, parsed: Option<&ParsedSnapshot>) -> ClaudeWorkflowRunStatus {
    if let Some(status) = raw.and_then(run_status) {
        return status;
    }
    if parsed.is_some_and(ParsedSnapshot::has_structure) {
        ClaudeWorkflowRunStatus::Stopped
    } else {
        ClaudeWorkflowRunStatus::Unavailable
    }
}

/// Reads every `wf_*.json` file in the session's `workflows/` directory.
/// Returns an empty vec (not an error) when the directory is absent; an
/// unreadable or malformed file is logged and skipped.
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
        if let Some(run) = read_run_record_file(&entry.path()).await {
            runs.push(run);
        }
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

    let value = match serde_json::from_str::<Value>(&contents) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "failed to parse workflow run record");
            return None;
        }
    };
    let run = parse_run_record(&value);
    if run.is_none() {
        tracing::warn!(path = %path.display(), "workflow run record has no taskId");
    }
    run
}
