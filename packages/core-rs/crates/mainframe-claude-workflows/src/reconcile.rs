//! Terminal reconciliation: once a run goes terminal in memory, spawn a task
//! that reads the on-disk record and, if found, supersedes the retained
//! snapshot via `store::ClaudeWorkflowStore::apply_record`. When no record is
//! found — unreadable, or not yet flushed — the stamped terminal status and
//! retained snapshot are left alone; the daemon never invents an outcome the
//! record did not supply.

use std::path::PathBuf;
use std::sync::Arc;

use crate::record::read_run_records;
use crate::store::ClaudeWorkflowStore;

/// Where a chat's Claude session writes its workflow records.
pub struct RecordLocation {
    pub project_dir: PathBuf,
    pub session_id: String,
}

pub fn spawn_terminal_reconcile(
    store: Arc<ClaudeWorkflowStore>,
    chat_id: String,
    task_id: String,
    loc: RecordLocation,
) {
    tokio::spawn(async move {
        let records = read_run_records(&loc.project_dir, &loc.session_id).await;
        let Some(record) = records.into_iter().find(|run| run.task_id == task_id) else {
            tracing::debug!(
                chat_id = %chat_id,
                task_id = %task_id,
                session_id = %loc.session_id,
                "no workflow run record found for terminal task"
            );
            return;
        };
        store.apply_record(&chat_id, record);
    });
}
