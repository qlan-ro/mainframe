//! Stopping background tasks: the CLI session's own stop request first, then
//! signals to the processes writing the task's spool file.

use mainframe_types::BoxFuture;
use mainframe_types::background_task::{BackgroundTask, BackgroundTaskStatus};

use crate::tracker::{BackgroundTaskTracker, TerminalUpdate};

mod chat;
mod os;
mod sweep_output;

pub use chat::{
    FailedEntry, KillTasksForChatArgs, KillTasksForChatResult, KilledEntry, SweptEntry,
    kill_tasks_for_chat,
};
pub(crate) use os::{KillSeam, new_seam};

/// How a task was stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Via {
    /// The CLI session stopped it.
    StopTask,
    /// Its spool writers were signalled.
    Signal,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum KillError {
    #[error("task not found")]
    NotFound,
    #[error("writer probe failed: {0}")]
    ProbeFailed(String),
    /// No session stopped the task and there was nothing to signal: no
    /// process writes its spool file, or it has no spool file at all.
    /// Carries the session's error when one refused.
    #[error("{}", stop_error.as_deref().unwrap_or("no live writer"))]
    Unreachable { stop_error: Option<String> },
    /// Writers were signalled but these pids still hold the spool file.
    #[error("pids still alive: {}", join_pids(pids))]
    Survivors { pids: Vec<u32> },
}

fn join_pids(pids: &[u32]) -> String {
    pids.iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

/// The part of a live CLI session the kill path needs.
pub trait SessionLike: Send + Sync {
    fn stop_background_task<'a>(&'a self, task_id: &'a str) -> BoxFuture<'a, StopResult>;
}

#[derive(Debug, Clone)]
pub struct StopResult {
    pub ok: bool,
    pub error: Option<String>,
}

pub struct KillArgs<'a> {
    pub chat_id: &'a str,
    pub task_id: &'a str,
    /// `None` when the chat has no live CLI, for example a task recovered
    /// after a daemon restart.
    pub session: Option<&'a dyn SessionLike>,
    pub tracker: &'a BackgroundTaskTracker,
}

/// Stop one task. A task the CLI agreed to stop ends through the CLI's own
/// notification; a signalled task is marked stopped here.
pub async fn kill_background_task(args: KillArgs<'_>) -> Result<Via, KillError> {
    let task = args
        .tracker
        .get(args.chat_id, args.task_id)
        .ok_or(KillError::NotFound)?;
    stop_task(args.tracker, args.chat_id, &task, args.session).await
}

/// Ask the session to stop `task`, falling back to signalling its spool
/// writers. On the signal path the task is marked stopped.
async fn stop_task(
    tracker: &BackgroundTaskTracker,
    chat_id: &str,
    task: &BackgroundTask,
    session: Option<&dyn SessionLike>,
) -> Result<Via, KillError> {
    let mut stop_error = None;
    if let Some(session) = session {
        let stop = session.stop_background_task(&task.id).await;
        if stop.ok {
            return Ok(Via::StopTask);
        }
        tracing::warn!(chat_id, task_id = %task.id, error = ?stop.error, "stop_task failed; signalling spool writers");
        stop_error = stop.error;
    }
    let Some(output_path) = task.output_path.as_deref() else {
        return Err(KillError::Unreachable { stop_error });
    };
    match os::signal_writers(&tracker.process, output_path).await {
        Ok(()) => {
            mark_stopped(tracker, chat_id, &task.id, "killed via signal");
            Ok(Via::Signal)
        }
        Err(os::SignalFailure::Probe(error)) => Err(KillError::ProbeFailed(error.to_string())),
        Err(os::SignalFailure::NoWriter) => Err(KillError::Unreachable { stop_error }),
        Err(os::SignalFailure::Survivors(pids)) => Err(KillError::Survivors { pids }),
    }
}

fn mark_stopped(tracker: &BackgroundTaskTracker, chat_id: &str, task_id: &str, summary: &str) {
    tracker.end(
        chat_id,
        task_id,
        TerminalUpdate {
            status: BackgroundTaskStatus::Stopped,
            output_path: String::new(),
            summary: summary.to_string(),
            usage: None,
        },
    );
}

#[cfg(test)]
#[path = "kill_tests.rs"]
mod tests;
