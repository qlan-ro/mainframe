//! Stopping every task of a chat, plus a sweep of stray writers in a
//! worktree's spool directory before the worktree is removed.

use std::path::Path;

use mainframe_types::background_task::BackgroundTask;

use super::{KillError, SessionLike, Via, mark_stopped, os, stop_task};
use crate::encoding::encode_cwd_segment;
use crate::lsof::lsof_writers;
use crate::spool_root::spool_root;
use crate::spool_walker::walk_spool_tasks;
use crate::tracker::BackgroundTaskTracker;

pub struct KillTasksForChatArgs<'a> {
    pub chat_id: &'a str,
    /// When set, also signal every writer of a spool file under this
    /// worktree's encoded directory, tracked or not.
    pub worktree_path: Option<&'a str>,
    pub session: Option<&'a dyn SessionLike>,
    pub tracker: &'a BackgroundTaskTracker,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KilledEntry {
    pub task_id: String,
    pub via: Via,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FailedEntry {
    pub task_id: String,
    pub error: KillError,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SweptEntry {
    pub pid: u32,
    pub command: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct KillTasksForChatResult {
    pub killed: Vec<KilledEntry>,
    pub failed: Vec<FailedEntry>,
    pub swept: Vec<SweptEntry>,
}

/// Stop every running task of the chat and mark each stopped, then sweep the
/// worktree's spool directory if one is given.
pub async fn kill_tasks_for_chat(args: KillTasksForChatArgs<'_>) -> KillTasksForChatResult {
    kill_tasks_for_chat_under(args, &spool_root()).await
}

pub(super) async fn kill_tasks_for_chat_under(
    args: KillTasksForChatArgs<'_>,
    spool_root: &Path,
) -> KillTasksForChatResult {
    let mut result = KillTasksForChatResult::default();
    for task in args.tracker.list_live(args.chat_id) {
        kill_task(&args, &task, &mut result).await;
    }
    if let Some(worktree_path) = args.worktree_path {
        sweep_worktree(&args, worktree_path, spool_root, &mut result).await;
    }

    if !result.failed.is_empty() {
        tracing::warn!(chat_id = %args.chat_id, failed = ?result.failed, "some background tasks could not be stopped");
    }
    if !result.swept.is_empty() {
        tracing::info!(chat_id = %args.chat_id, swept = ?result.swept, "worktree sweep killed extras");
    }
    result
}

async fn kill_task(
    args: &KillTasksForChatArgs<'_>,
    task: &BackgroundTask,
    result: &mut KillTasksForChatResult,
) {
    match stop_task(args.tracker, args.chat_id, task, args.session).await {
        Ok(via) => {
            // The chat is going away, so don't wait for the CLI's notification.
            if via == Via::StopTask {
                mark_stopped(args.tracker, args.chat_id, &task.id, "killed via stop_task");
            }
            result.killed.push(KilledEntry {
                task_id: task.id.clone(),
                via,
            });
        }
        Err(error) => result.failed.push(FailedEntry {
            task_id: task.id.clone(),
            error,
        }),
    }
}

async fn sweep_worktree(
    args: &KillTasksForChatArgs<'_>,
    worktree_path: &str,
    spool_root: &Path,
    result: &mut KillTasksForChatResult,
) {
    let real_worktree = match tokio::fs::canonicalize(worktree_path).await {
        Ok(path) => path,
        Err(error) => {
            tracing::warn!(%error, worktree_path, "worktree sweep aborted");
            return;
        }
    };
    let cwd_seg = encode_cwd_segment(&real_worktree.to_string_lossy());
    for entry in walk_spool_tasks(spool_root, Some(&cwd_seg)).await {
        // Never follow a symlink out of the spool.
        let is_regular_file = tokio::fs::symlink_metadata(&entry.fp)
            .await
            .is_ok_and(|metadata| metadata.is_file());
        if is_regular_file {
            sweep_file(args.tracker, &entry.fp, result).await;
        }
    }
}

async fn sweep_file(
    tracker: &BackgroundTaskTracker,
    file: &str,
    result: &mut KillTasksForChatResult,
) {
    for pid in lsof_writers(&tracker.process, file).await {
        if pid == std::process::id() {
            continue;
        }
        let command = os::command_for_pid(&tracker.process, pid).await;
        match os::sigterm_then_kill(&tracker.process, pid).await {
            Err(error) if error.root_failed => {
                tracing::error!(pid, command = %command, %error, "worktree sweep kill failed");
            }
            outcome => {
                tracing::info!(pid, command = %command, file, "worktree sweep killed pid");
                if let Err(error) = outcome {
                    tracing::warn!(pid, command = %command, %error, "worktree sweep left descendants unsignalled");
                }
                result.swept.push(SweptEntry { pid, command });
            }
        }
    }
}
