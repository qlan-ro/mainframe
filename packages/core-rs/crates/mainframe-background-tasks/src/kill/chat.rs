use super::*;

// --- killTasksForChat orchestrator ---

pub struct KillTasksForChatArgs<'a> {
    pub chat_id: &'a str,
    /// When set, the worktree sweep targets `${spoolRoot}/{encoded(worktreePath)}/…`.
    pub worktree_path: Option<&'a str>,
    pub session: Option<&'a dyn SessionLike>,
    pub tracker: &'a BackgroundTaskTracker,
    /// Test-only override; production callers default to spoolRoot().
    pub spool_root: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KilledEntry {
    pub task_id: String,
    pub via: Via,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FailedEntry {
    pub task_id: String,
    pub error: String,
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

pub async fn kill_tasks_for_chat(args: KillTasksForChatArgs<'_>) -> KillTasksForChatResult {
    let mut result = KillTasksForChatResult::default();
    let running: Vec<_> = args
        .tracker
        .list(args.chat_id)
        .into_iter()
        .filter(|t| t.status == BackgroundTaskStatus::Running)
        .collect();

    for task in running {
        kill_task(&args, &task, &mut result).await;
    }

    sweep(&args, &mut result).await;

    if !result.failed.is_empty() {
        tracing::warn!(target: "background-tasks:kill", chat_id = %args.chat_id, failed = ?result.failed, "killTasksForChat: some failures");
    }
    if !result.swept.is_empty() {
        tracing::info!(target: "background-tasks:kill", chat_id = %args.chat_id, swept = ?result.swept, "worktree sweep killed extras");
    }

    result
}

async fn kill_task(
    args: &KillTasksForChatArgs<'_>,
    task: &mainframe_types::background_task::BackgroundTask,
    result: &mut KillTasksForChatResult,
) {
    if let Some(session) = args.session {
        let stop = session.stop_background_task(&task.id).await;
        if stop.ok {
            record_stopped(args, task, result, Via::StopTask, "killed via stop_task");
            return;
        }
        tracing::warn!(target: "background-tasks:kill", chat_id = %args.chat_id, task_id = %task.id, err = ?stop.error, "stop_task failed; OS fallback");
    }

    let os = kill_one_task_os(&args.tracker.process, task.output_path.as_deref(), |pid| {
        sigterm_then_kill(&args.tracker.process, pid)
    })
    .await;
    match os {
        OsKillOutcome::Ok => {
            record_stopped(args, task, result, Via::Signal, "killed via signal");
        }
        OsKillOutcome::Err { error, .. } => {
            result.failed.push(FailedEntry {
                task_id: task.id.clone(),
                error,
            });
        }
    }
}

async fn sweep(args: &KillTasksForChatArgs<'_>, result: &mut KillTasksForChatResult) {
    if let Some(worktree_path) = args.worktree_path {
        match tokio::fs::canonicalize(worktree_path).await {
            Err(err) => {
                tracing::warn!(target: "background-tasks:kill", err = %err, worktree_path = %worktree_path, "worktree sweep aborted");
            }
            Ok(real_wt) => {
                let scoped_cwd_seg = encode_cwd_segment(&real_wt.to_string_lossy());
                let root = args
                    .spool_root
                    .clone()
                    .unwrap_or_else(|| default_spool_root().to_string_lossy().into_owned());
                let entries = walk_spool_tasks(&WalkOpts {
                    root,
                    scoped_cwd_seg: Some(scoped_cwd_seg),
                })
                .await;
                for entry in entries {
                    match tokio::fs::symlink_metadata(&entry.fp).await {
                        Ok(md) if md.is_file() && !md.file_type().is_symlink() => {}
                        _ => continue,
                    }
                    sweep_file(args, &entry.fp, result).await;
                }
            }
        }
    }
}

fn record_stopped(
    args: &KillTasksForChatArgs<'_>,
    task: &mainframe_types::background_task::BackgroundTask,
    result: &mut KillTasksForChatResult,
    via: Via,
    summary: &str,
) {
    args.tracker.end(
        args.chat_id,
        &task.id,
        TerminalUpdate {
            status: BackgroundTaskStatus::Stopped,
            output_path: task.output_path.clone().unwrap_or_default(),
            summary: summary.to_string(),
            usage: None,
        },
    );
    result.killed.push(KilledEntry {
        task_id: task.id.clone(),
        via,
    });
}

async fn sweep_file(
    args: &KillTasksForChatArgs<'_>,
    file: &str,
    result: &mut KillTasksForChatResult,
) {
    let writers = lsof_writers(&args.tracker.process, file).await;
    for pid in writers {
        if pid == std::process::id() {
            continue;
        }
        let command = command_for_pid(&args.tracker.process, pid).await;
        let r = sigterm_then_kill(&args.tracker.process, pid).await;
        if r.ok {
            result.swept.push(SweptEntry {
                pid,
                command: command.clone(),
            });
            tracing::info!(target: "background-tasks:kill", pid, command = %command, file = %file, "worktree sweep killed pid");
        } else {
            tracing::error!(target: "background-tasks:kill", pid, command = %command, err = ?r.error, "worktree sweep kill failed");
        }
    }
}
