//! Background-task termination with tracker-owned process inspection and signals.

use std::future::Future;
use std::pin::Pin;
#[cfg(test)]
use std::sync::{Arc, Mutex};

use mainframe_types::background_task::BackgroundTaskStatus;

use crate::encoding::encode_cwd_segment;
use crate::lsof::lsof_writers;
use crate::spool_root::spool_root as default_spool_root;
use crate::spool_walker::{WalkOpts, walk_spool_tasks};
use crate::tracker::{BackgroundTaskTracker, TerminalUpdate};

pub const GRACE_MS: u64 = 800;

/// Which kill path produced the outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Via {
    StopTask,
    Signal,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KillResult {
    Ok { via: Via },
    Err { error: String, via: Via },
}

/// The subset of a live CLI session the kill path needs.
pub trait SessionLike: Send + Sync {
    fn stop_background_task<'a>(
        &'a self,
        task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = StopResult> + Send + 'a>>;
}

#[derive(Debug, Clone)]
pub struct StopResult {
    pub ok: bool,
    pub error: Option<String>,
}

pub struct KillArgs<'a> {
    pub chat_id: &'a str,
    pub task_id: &'a str,
    /// None when no live CLI for this chat (e.g. recovered orphan).
    pub session: Option<&'a dyn SessionLike>,
    pub tracker: &'a BackgroundTaskTracker,
}

mod os;
pub use os::Signal;
pub(crate) use os::{KillSeam, new_seam};
use os::{OsKillOutcome, OsKillReason, command_for_pid, kill_one_task_os, sigterm_then_kill};
#[cfg(test)]
use os::{set_ps_comm_for_tests, set_tree_kill_for_tests};

pub async fn kill_background_task(args: KillArgs<'_>) -> KillResult {
    let Some(task) = args.tracker.get(args.chat_id, args.task_id) else {
        return KillResult::Err {
            error: "task not found".to_string(),
            via: Via::None,
        };
    };

    let mut stop_err: Option<String> = None;
    if let Some(session) = args.session {
        let stop = session.stop_background_task(args.task_id).await;
        if stop.ok {
            return KillResult::Ok { via: Via::StopTask };
        }
        stop_err = stop.error.clone();
        tracing::warn!(target: "background-tasks:kill", chat_id = %args.chat_id, task_id = %args.task_id, err = ?stop.error, "stop_task failed; OS fallback");
    }

    let os = kill_one_task_os(&args.tracker.process, task.output_path.as_deref(), |pid| {
        sigterm_then_kill(&args.tracker.process, pid)
    })
    .await;
    match os {
        OsKillOutcome::Ok => {
            args.tracker.end(
                args.chat_id,
                args.task_id,
                TerminalUpdate {
                    status: BackgroundTaskStatus::Stopped,
                    output_path: task.output_path.clone().unwrap_or_default(),
                    summary: "killed via signal".to_string(),
                    usage: None,
                },
            );
            KillResult::Ok { via: Via::Signal }
        }
        // Preserve prior behavior: no live writer / no outputPath (and stop_task
        // already failed) → via:'none'; an OS signal that ran but left survivors →
        // via:'signal'.
        OsKillOutcome::Err { reason, error } => {
            let err = stop_err.unwrap_or(error);
            if reason == OsKillReason::Survivors {
                KillResult::Err {
                    error: err,
                    via: Via::Signal,
                }
            } else {
                KillResult::Err {
                    error: err,
                    via: Via::None,
                }
            }
        }
    }
}

mod chat;
pub use chat::{
    FailedEntry, KillTasksForChatArgs, KillTasksForChatResult, KilledEntry, SweptEntry,
    kill_tasks_for_chat,
};

#[cfg(test)]
mod tests;
