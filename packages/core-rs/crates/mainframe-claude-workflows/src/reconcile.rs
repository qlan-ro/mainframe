//! Terminal reconciliation: once a run goes terminal in memory, spawn a task
//! that reads the on-disk record and, if found, supersedes the retained
//! snapshot via `store::ClaudeWorkflowStore::apply_record`. When no record is
//! found — unreadable, or not yet flushed — the stamped terminal status and
//! retained snapshot are left alone; the daemon never invents an outcome the
//! record did not supply.

use std::path::PathBuf;
use std::sync::Arc;

use crate::store::ClaudeWorkflowStore;

/// Where a chat's Claude session writes its workflow records.
pub struct RecordLocation {
    pub project_dir: PathBuf,
    pub session_id: String,
}

pub fn spawn_terminal_reconcile(
    _store: Arc<ClaudeWorkflowStore>,
    _chat_id: String,
    _task_id: String,
    _loc: RecordLocation,
) {
    unimplemented!("wf-core")
}
