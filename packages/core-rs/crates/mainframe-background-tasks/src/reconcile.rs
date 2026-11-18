//! Boot-time recovery: rebuild tracker entries for bash tasks whose spool
//! files outlived a daemon restart.

use std::collections::HashMap;
use std::fs::Metadata;
use std::path::Path;

use mainframe_types::background_task::{
    BackgroundTask, BackgroundTaskStatus, BackgroundTaskToolName, BackgroundWorkKind,
};
use mainframe_types::chat::{Chat, ChatStatus};

use crate::encoding::encode_cwd_segment;
use crate::lsof::lsof_writers;
use crate::spool_root::{is_task_output_under, spool_root};
use crate::spool_walker::walk_spool_tasks;
use crate::tracker::BackgroundTaskTracker;

/// The database state reconcile reads.
pub struct ReconcileSnapshot {
    pub chats: Vec<Chat>,
    /// Project id → project path.
    pub project_paths: HashMap<String, String>,
}

/// Adopt every spooled task that belongs to a non-archived chat: running if a
/// process still writes its spool file, stopped otherwise.
pub async fn reconcile_background_tasks(
    tracker: &BackgroundTaskTracker,
    snapshot: ReconcileSnapshot,
) {
    reconcile_under(tracker, snapshot, &spool_root()).await;
}

async fn reconcile_under(
    tracker: &BackgroundTaskTracker,
    snapshot: ReconcileSnapshot,
    root: &Path,
) {
    let ReconcileSnapshot {
        chats,
        project_paths,
    } = snapshot;
    let chat_by_session = chats_by_session(chats);
    if chat_by_session.is_empty() {
        return;
    }

    for entry in walk_spool_tasks(root, None).await {
        let Some(chat) = chat_by_session.get(&entry.sess) else {
            continue;
        };
        let Some(effective_path) = chat
            .worktree_path
            .as_ref()
            .or_else(|| project_paths.get(&chat.project_id))
        else {
            continue;
        };
        let Ok(real_effective) = tokio::fs::canonicalize(effective_path).await else {
            continue;
        };
        if encode_cwd_segment(&real_effective.to_string_lossy()) != entry.cwd_seg {
            continue;
        }
        if !is_task_output_under(root, Path::new(&entry.fp), &entry.task_id).await {
            continue;
        }
        let Some(metadata) = regular_file_metadata(&entry.fp).await else {
            continue;
        };

        let writers = lsof_writers(&tracker.process, &entry.fp).await;
        tracker.adopt(
            &chat.id,
            recovered_task(&entry.task_id, &entry.fp, &metadata, !writers.is_empty()),
        );
        if let Some(&pid) = writers.first() {
            tracker.set_pid(&chat.id, &entry.task_id, pid);
        }
    }
}

/// Non-archived chats keyed by their vendor session id, the spool's `<sess>`
/// directory name.
fn chats_by_session(chats: Vec<Chat>) -> HashMap<String, Chat> {
    chats
        .into_iter()
        .filter(|chat| chat.status != ChatStatus::Archived)
        .filter_map(|chat| Some((chat.vendor_session_id.clone()?, chat)))
        .collect()
}

fn recovered_task(task_id: &str, fp: &str, metadata: &Metadata, running: bool) -> BackgroundTask {
    BackgroundTask {
        id: task_id.to_string(),
        // Only bash tasks spool to disk, so only they can be recovered.
        kind: BackgroundWorkKind::Bash,
        tool_name: BackgroundTaskToolName::Bash,
        tool_use_id: String::new(),
        command: "<recovered>".to_string(),
        description: String::new(),
        output_path: Some(fp.to_string()),
        started_at: ctime_ms(metadata),
        ended_at: (!running).then(|| mtime_ms(metadata)),
        status: if running {
            BackgroundTaskStatus::Running
        } else {
            BackgroundTaskStatus::Stopped
        },
        last_output_line: None,
        summary: (!running).then(|| "recovered after daemon restart".to_string()),
        usage: None,
        recovered: Some(true),
        workflow_name: None,
        run_id: None,
    }
}

/// Metadata of `path` when it is a regular file and not a symlink.
async fn regular_file_metadata(path: &str) -> Option<Metadata> {
    let metadata = tokio::fs::symlink_metadata(path).await.ok()?;
    metadata.is_file().then_some(metadata)
}

#[cfg(unix)]
fn ctime_ms(md: &Metadata) -> i64 {
    use std::os::unix::fs::MetadataExt;
    md.ctime() * 1000 + md.ctime_nsec() / 1_000_000
}

#[cfg(unix)]
fn mtime_ms(md: &Metadata) -> i64 {
    use std::os::unix::fs::MetadataExt;
    md.mtime() * 1000 + md.mtime_nsec() / 1_000_000
}

#[cfg(not(unix))]
fn system_time_ms(t: std::io::Result<std::time::SystemTime>) -> i64 {
    t.ok()
        .and_then(|st| st.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(not(unix))]
fn ctime_ms(md: &Metadata) -> i64 {
    system_time_ms(md.created())
}

#[cfg(not(unix))]
fn mtime_ms(md: &Metadata) -> i64 {
    system_time_ms(md.modified())
}

#[cfg(test)]
#[path = "reconcile_tests.rs"]
mod tests;
