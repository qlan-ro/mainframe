//! Reads completed-run records off disk:
//! `<claude project dir>/<sessionId>/workflows/wf_<runId>.json`. A directory
//! that does not exist means the run was interrupted before it could write
//! one — the normal case, not an error (todo constraint 8).

use std::path::{Path, PathBuf};

use mainframe_types::claude_workflow::ClaudeWorkflowRun;
use serde_json::Value;

/// `<project_dir>/<session_id>/workflows`.
pub fn workflows_dir(_project_dir: &Path, _session_id: &str) -> PathBuf {
    unimplemented!("wf-core")
}

/// Maps one `wf_<runId>.json` record into a `Record`-sourced
/// `ClaudeWorkflowRun`. Returns `None` for a malformed (non-object) record.
pub fn parse_run_record(_value: &Value) -> Option<ClaudeWorkflowRun> {
    unimplemented!("wf-core")
}

/// Reads every `wf_*.json` file in the session's `workflows/` directory.
/// Returns an empty vec (not an error) when the directory is absent.
pub async fn read_run_records(_project_dir: &Path, _session_id: &str) -> Vec<ClaudeWorkflowRun> {
    unimplemented!("wf-core")
}
