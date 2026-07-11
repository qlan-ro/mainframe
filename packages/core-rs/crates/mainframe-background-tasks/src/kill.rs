//! Ported from `packages/core/src/background-tasks/kill.ts`.
//!
//! `treeKill` (npm) is not available as an allowlisted crate, so its POSIX
//! algorithm is reimplemented here: enumerate the descendant pids (`pgrep -P`
//! recursion) and signal each. The signal delivery shells out to `kill` (no
//! `libc`). Both the tree-kill and `ps -o comm=` touchpoints are behind global
//! seams so the mock-heavy TS tests translate.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::Duration;

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

// --- process-signalling seams (tree-kill + `ps -o comm=`) ---

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Signal {
    Sigterm,
    Sigkill,
}

impl Signal {
    fn kill_flag(self) -> &'static str {
        match self {
            Signal::Sigterm => "-TERM",
            Signal::Sigkill => "-KILL",
        }
    }
}

type TreeKillFuture = Pin<Box<dyn Future<Output = Result<(), String>> + Send>>;
type TreeKillFn = Arc<dyn Fn(u32, Signal) -> TreeKillFuture + Send + Sync>;
type PsCommFuture = Pin<Box<dyn Future<Output = String> + Send>>;
type PsCommFn = Arc<dyn Fn(u32) -> PsCommFuture + Send + Sync>;

struct KillSeam {
    tree_kill: TreeKillFn,
    ps_comm: PsCommFn,
}

fn kill_seam() -> &'static Mutex<KillSeam> {
    static SEAM: OnceLock<Mutex<KillSeam>> = OnceLock::new();
    SEAM.get_or_init(|| {
        Mutex::new(KillSeam {
            tree_kill: Arc::new(|pid, signal| Box::pin(real_tree_kill(pid, signal))),
            ps_comm: Arc::new(|pid| Box::pin(real_command_for_pid(pid))),
        })
    })
}

fn lock_kill_seam() -> MutexGuard<'static, KillSeam> {
    kill_seam()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Test-only seam — swap the tree-kill implementation.
pub fn set_tree_kill_for_tests(fn_: TreeKillFn) {
    lock_kill_seam().tree_kill = fn_;
}

/// Test-only seam — swap the `ps -o comm=` implementation.
pub fn set_ps_comm_for_tests(fn_: PsCommFn) {
    lock_kill_seam().ps_comm = fn_;
}

async fn tree_kill(pid: u32, signal: Signal) -> Result<(), String> {
    let f = lock_kill_seam().tree_kill.clone();
    f(pid, signal).await
}

/// Default tree-kill: collect `pid` + all descendants, then signal each.
async fn real_tree_kill(pid: u32, signal: Signal) -> Result<(), String> {
    let mut all = vec![pid];
    collect_descendants(pid, &mut all).await;
    for p in all {
        // Best-effort: a pid already gone (ESRCH) is not a failure.
        let mut command = tokio::process::Command::new("kill");
        command
            .arg(signal.kill_flag())
            .arg(p.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        crate::spawn_env::apply(&mut command);
        let _ = command.status().await;
    }
    Ok(())
}

async fn collect_descendants(pid: u32, out: &mut Vec<u32>) {
    let mut command = tokio::process::Command::new("pgrep");
    command.arg("-P").arg(pid.to_string());
    crate::spawn_env::apply(&mut command);
    let output = command.output().await;
    if let Ok(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let children: Vec<u32> = stdout
            .split_whitespace()
            .filter_map(|s| s.parse::<u32>().ok())
            .collect();
        for child in children {
            if !out.contains(&child) {
                out.push(child);
                Box::pin(collect_descendants(child, out)).await;
            }
        }
    }
}

async fn sigterm_then_kill(pid: u32) -> StopResult {
    if let Err(sig_err) = tree_kill(pid, Signal::Sigterm).await {
        tracing::warn!(target: "background-tasks:kill", pid, err = %sig_err, "SIGTERM failed; trying SIGKILL");
    }
    tokio::time::sleep(Duration::from_millis(GRACE_MS)).await;
    match tree_kill(pid, Signal::Sigkill).await {
        Err(kill_err) => StopResult {
            ok: false,
            error: Some(kill_err),
        },
        Ok(()) => StopResult {
            ok: true,
            error: None,
        },
    }
}

async fn command_for_pid(pid: u32) -> String {
    let f = lock_kill_seam().ps_comm.clone();
    f(pid).await
}

async fn real_command_for_pid(pid: u32) -> String {
    let mut command = tokio::process::Command::new("ps");
    command
        .arg("-p")
        .arg(pid.to_string())
        .arg("-o")
        .arg("comm=");
    crate::spawn_env::apply(&mut command);
    let output = command.output().await;
    match output {
        Ok(output) => {
            let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if s.is_empty() {
                "unknown".to_string()
            } else {
                s
            }
        }
        Err(_) => "unknown".to_string(),
    }
}

/// The reason a `killOneTaskOS` attempt did not signal a live writer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OsKillReason {
    NoOutputPath,
    NoWriter,
    Survivors,
}

enum OsKillOutcome {
    Ok,
    Err { reason: OsKillReason, error: String },
}

/// OS-level kill for a single task: identify writers via lsof, signal them, then
/// re-check there are no survivors.
async fn kill_one_task_os<S, SFut>(output_path: Option<&str>, signaller: S) -> OsKillOutcome
where
    S: Fn(u32) -> SFut,
    SFut: Future<Output = StopResult>,
{
    let Some(output_path) = output_path else {
        return OsKillOutcome::Err {
            reason: OsKillReason::NoOutputPath,
            error: "no outputPath".to_string(),
        };
    };
    let writers = lsof_writers(output_path).await;
    if writers.is_empty() {
        return OsKillOutcome::Err {
            reason: OsKillReason::NoWriter,
            error: "no live writer".to_string(),
        };
    }
    for pid in &writers {
        let r = signaller(*pid).await;
        if !r.ok {
            tracing::warn!(target: "background-tasks:kill", pid = *pid, err = ?r.error, "signal failed for one pid");
        }
    }
    let remaining = lsof_writers(output_path).await;
    if !remaining.is_empty() {
        let joined = remaining
            .iter()
            .map(|p| p.to_string())
            .collect::<Vec<_>>()
            .join(",");
        return OsKillOutcome::Err {
            reason: OsKillReason::Survivors,
            error: format!("pids still alive: {joined}"),
        };
    }
    OsKillOutcome::Ok
}

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

    let os = kill_one_task_os(task.output_path.as_deref(), sigterm_then_kill).await;
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
        if let Some(session) = args.session {
            let stop = session.stop_background_task(&task.id).await;
            if stop.ok {
                args.tracker.end(
                    args.chat_id,
                    &task.id,
                    TerminalUpdate {
                        status: BackgroundTaskStatus::Stopped,
                        output_path: task.output_path.clone().unwrap_or_default(),
                        summary: "killed via stop_task".to_string(),
                        usage: None,
                    },
                );
                result.killed.push(KilledEntry {
                    task_id: task.id.clone(),
                    via: Via::StopTask,
                });
                continue;
            }
            tracing::warn!(target: "background-tasks:kill", chat_id = %args.chat_id, task_id = %task.id, err = ?stop.error, "stop_task failed; OS fallback");
        }

        let os = kill_one_task_os(task.output_path.as_deref(), sigterm_then_kill).await;
        match os {
            OsKillOutcome::Ok => {
                args.tracker.end(
                    args.chat_id,
                    &task.id,
                    TerminalUpdate {
                        status: BackgroundTaskStatus::Stopped,
                        output_path: task.output_path.clone().unwrap_or_default(),
                        summary: "killed via signal".to_string(),
                        usage: None,
                    },
                );
                result.killed.push(KilledEntry {
                    task_id: task.id.clone(),
                    via: Via::Signal,
                });
            }
            OsKillOutcome::Err { error, .. } => {
                result.failed.push(FailedEntry {
                    task_id: task.id.clone(),
                    error,
                });
            }
        }
    }

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
                    let writers = lsof_writers(&entry.fp).await;
                    for pid in writers {
                        if pid == std::process::id() {
                            continue;
                        }
                        let command = command_for_pid(pid).await;
                        let r = sigterm_then_kill(pid).await;
                        if r.ok {
                            result.swept.push(SweptEntry {
                                pid,
                                command: command.clone(),
                            });
                            tracing::info!(target: "background-tasks:kill", pid, command = %command, file = %entry.fp, "worktree sweep killed pid");
                        } else {
                            tracing::error!(target: "background-tasks:kill", pid, command = %command, err = ?r.error, "worktree sweep kill failed");
                        }
                    }
                }
            }
        }
    }

    if !result.failed.is_empty() {
        tracing::warn!(target: "background-tasks:kill", chat_id = %args.chat_id, failed = ?result.failed, "killTasksForChat: some failures");
    }
    if !result.swept.is_empty() {
        tracing::info!(target: "background-tasks:kill", chat_id = %args.chat_id, swept = ?result.swept, "worktree sweep killed extras");
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lsof::{ExecCode, ExecFn, ExecOk, LsofExecError, set_exec_for_tests};
    use crate::seam_test_guard;
    use crate::tracker::TaskSeed;
    use mainframe_types::background_task::BackgroundTaskToolName;
    use std::collections::VecDeque;
    use std::fs;
    use tempfile::tempdir;

    enum Canned {
        Writers(Vec<u32>),
        Empty,
    }

    fn writers_stdout(pids: &[u32]) -> String {
        let mut s = String::new();
        for p in pids {
            s.push_str(&format!("p{p}\naw\nn/p\n"));
        }
        s
    }

    fn set_lsof_queue(responses: Vec<Canned>) {
        let q = Arc::new(Mutex::new(VecDeque::from(responses)));
        let exec: ExecFn = Arc::new(move |_c, _a| {
            let item = q.lock().unwrap_or_else(|p| p.into_inner()).pop_front();
            Box::pin(async move {
                match item {
                    Some(Canned::Writers(pids)) => Ok(ExecOk {
                        stdout: writers_stdout(&pids),
                    }),
                    _ => Err(LsofExecError {
                        code: Some(ExecCode::Number(1)),
                        signal: None,
                        stdout: Some(String::new()),
                    }),
                }
            })
        });
        set_exec_for_tests(exec);
    }

    fn set_lsof_constant(pids: Vec<u32>) {
        let stdout = writers_stdout(&pids);
        set_exec_for_tests(Arc::new(move |_c, _a| {
            let stdout = stdout.clone();
            Box::pin(async move { Ok(ExecOk { stdout }) })
        }));
    }

    /// tree-kill stub that records (pid, signal) and succeeds. Returns the log.
    fn record_tree_kill() -> Arc<Mutex<Vec<(u32, Signal)>>> {
        let log = Arc::new(Mutex::new(Vec::new()));
        let log2 = log.clone();
        set_tree_kill_for_tests(Arc::new(move |pid, signal| {
            log2.lock()
                .unwrap_or_else(|p| p.into_inner())
                .push((pid, signal));
            Box::pin(async { Ok(()) })
        }));
        log
    }

    fn tk_calls(log: &Arc<Mutex<Vec<(u32, Signal)>>>) -> Vec<(u32, Signal)> {
        log.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    struct MockSession {
        result: StopResult,
        called: Arc<Mutex<bool>>,
    }
    impl SessionLike for MockSession {
        fn stop_background_task<'a>(
            &'a self,
            _task_id: &'a str,
        ) -> Pin<Box<dyn Future<Output = StopResult> + Send + 'a>> {
            *self.called.lock().unwrap_or_else(|p| p.into_inner()) = true;
            let r = self.result.clone();
            Box::pin(async move { r })
        }
    }

    fn seed(tracker: &BackgroundTaskTracker, chat: &str, id: &str, output_path: &str) {
        tracker.start(
            chat,
            TaskSeed {
                id: id.to_string(),
                tool_name: BackgroundTaskToolName::Bash,
                tool_use_id: "u".to_string(),
                command: "x".to_string(),
                description: String::new(),
            },
            output_path.to_string(),
        );
    }

    // --- killBackgroundTask ---

    #[tokio::test(start_paused = true)]
    async fn returns_ok_via_stop_task_when_cli_succeeds() {
        let _guard = seam_test_guard();
        let tk = record_tree_kill();
        let tracker = BackgroundTaskTracker::new();
        seed(
            &tracker,
            "c",
            "t1",
            "/tmp/claude-501/-x/sess/tasks/t1.output",
        );
        let session = MockSession {
            result: StopResult {
                ok: true,
                error: None,
            },
            called: Arc::new(Mutex::new(false)),
        };
        let r = kill_background_task(KillArgs {
            chat_id: "c",
            task_id: "t1",
            session: Some(&session),
            tracker: &tracker,
        })
        .await;
        assert_eq!(r, KillResult::Ok { via: Via::StopTask });
        assert!(tk_calls(&tk).is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn falls_back_to_lsof_and_signal_when_stop_fails_and_writer_exists() {
        let _guard = seam_test_guard();
        set_lsof_queue(vec![Canned::Writers(vec![42]), Canned::Empty]);
        let tk = record_tree_kill();
        let tracker = BackgroundTaskTracker::new();
        seed(
            &tracker,
            "c",
            "t1",
            "/tmp/claude-501/-x/sess/tasks/t1.output",
        );
        let session = MockSession {
            result: StopResult {
                ok: false,
                error: Some("offline".to_string()),
            },
            called: Arc::new(Mutex::new(false)),
        };
        let r = kill_background_task(KillArgs {
            chat_id: "c",
            task_id: "t1",
            session: Some(&session),
            tracker: &tracker,
        })
        .await;
        let calls = tk_calls(&tk);
        assert!(calls.contains(&(42, Signal::Sigterm)));
        assert!(calls.contains(&(42, Signal::Sigkill)));
        assert_eq!(r, KillResult::Ok { via: Via::Signal });
    }

    #[tokio::test(start_paused = true)]
    async fn reports_failure_when_no_writer_and_stop_failed() {
        let _guard = seam_test_guard();
        set_lsof_queue(vec![Canned::Empty]);
        record_tree_kill();
        let tracker = BackgroundTaskTracker::new();
        seed(
            &tracker,
            "c",
            "t1",
            "/tmp/claude-501/-x/sess/tasks/t1.output",
        );
        let session = MockSession {
            result: StopResult {
                ok: false,
                error: Some("timeout".to_string()),
            },
            called: Arc::new(Mutex::new(false)),
        };
        let r = kill_background_task(KillArgs {
            chat_id: "c",
            task_id: "t1",
            session: Some(&session),
            tracker: &tracker,
        })
        .await;
        assert_eq!(
            r,
            KillResult::Err {
                error: "timeout".to_string(),
                via: Via::None
            }
        );
    }

    #[tokio::test(start_paused = true)]
    async fn works_without_a_session_goes_straight_to_os_path() {
        let _guard = seam_test_guard();
        set_lsof_queue(vec![Canned::Writers(vec![99]), Canned::Empty]);
        let tk = record_tree_kill();
        let tracker = BackgroundTaskTracker::new();
        seed(
            &tracker,
            "c",
            "t1",
            "/tmp/claude-501/-x/sess/tasks/t1.output",
        );
        let r = kill_background_task(KillArgs {
            chat_id: "c",
            task_id: "t1",
            session: None,
            tracker: &tracker,
        })
        .await;
        assert!(tk_calls(&tk).contains(&(99, Signal::Sigkill)));
        assert_eq!(r, KillResult::Ok { via: Via::Signal });
    }

    #[tokio::test(start_paused = true)]
    async fn marks_the_task_stopped_after_os_path_success() {
        let _guard = seam_test_guard();
        set_lsof_queue(vec![Canned::Writers(vec![99]), Canned::Empty]);
        record_tree_kill();
        let tracker = BackgroundTaskTracker::new();
        seed(&tracker, "c", "t1", "/p/t1.out");
        let r = kill_background_task(KillArgs {
            chat_id: "c",
            task_id: "t1",
            session: None,
            tracker: &tracker,
        })
        .await;
        assert_eq!(r, KillResult::Ok { via: Via::Signal });
        let t = tracker.get("c", "t1").unwrap();
        assert_eq!(t.status, BackgroundTaskStatus::Stopped);
        assert_eq!(t.summary.as_deref(), Some("killed via signal"));
        assert_eq!(t.output_path.as_deref(), Some("/p/t1.out"));
    }

    #[tokio::test(start_paused = true)]
    async fn returns_404_style_when_task_not_in_tracker() {
        let _guard = seam_test_guard();
        record_tree_kill();
        let tracker = BackgroundTaskTracker::new();
        let session = MockSession {
            result: StopResult {
                ok: true,
                error: None,
            },
            called: Arc::new(Mutex::new(false)),
        };
        let r = kill_background_task(KillArgs {
            chat_id: "c",
            task_id: "ghost",
            session: Some(&session),
            tracker: &tracker,
        })
        .await;
        assert_eq!(
            r,
            KillResult::Err {
                error: "task not found".to_string(),
                via: Via::None
            }
        );
    }

    // --- killTasksForChat (CLI + OS, no sweep) ---

    #[tokio::test(start_paused = true)]
    async fn cli_path_stop_task_succeeds_transitions_to_stopped() {
        let _guard = seam_test_guard();
        record_tree_kill();
        let tracker = BackgroundTaskTracker::new();
        seed(
            &tracker,
            "c1",
            "t1",
            "/tmp/claude-501/-x/sess/tasks/t1.output",
        );
        seed(
            &tracker,
            "c1",
            "t2",
            "/tmp/claude-501/-x/sess/tasks/t2.output",
        );
        let session = MockSession {
            result: StopResult {
                ok: true,
                error: None,
            },
            called: Arc::new(Mutex::new(false)),
        };
        let out = kill_tasks_for_chat(KillTasksForChatArgs {
            chat_id: "c1",
            worktree_path: None,
            session: Some(&session),
            tracker: &tracker,
            spool_root: Some("/tmp/claude-501".to_string()),
        })
        .await;
        let mut killed: Vec<String> = out.killed.iter().map(|k| k.task_id.clone()).collect();
        killed.sort();
        assert_eq!(killed, vec!["t1", "t2"]);
        assert!(out.failed.is_empty());
        assert!(tracker.list_all_running().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn os_path_no_session_lsof_writer_kill_succeeds() {
        let _guard = seam_test_guard();
        set_lsof_queue(vec![Canned::Writers(vec![321]), Canned::Empty]);
        let tk = record_tree_kill();
        let tracker = BackgroundTaskTracker::new();
        seed(
            &tracker,
            "c1",
            "t1",
            "/tmp/claude-501/-x/sess/tasks/t1.output",
        );
        let out = kill_tasks_for_chat(KillTasksForChatArgs {
            chat_id: "c1",
            worktree_path: None,
            session: None,
            tracker: &tracker,
            spool_root: Some("/tmp/claude-501".to_string()),
        })
        .await;
        let calls = tk_calls(&tk);
        assert!(calls.iter().any(|(p, _)| *p == 321));
        assert_eq!(
            out.killed,
            vec![KilledEntry {
                task_id: "t1".to_string(),
                via: Via::Signal
            }]
        );
        assert_eq!(
            tracker.get("c1", "t1").unwrap().status,
            BackgroundTaskStatus::Stopped
        );
    }

    #[tokio::test(start_paused = true)]
    async fn os_path_no_writer_no_session_stays_running_reported_failed() {
        let _guard = seam_test_guard();
        set_lsof_constant(vec![]);
        record_tree_kill();
        let tracker = BackgroundTaskTracker::new();
        seed(
            &tracker,
            "c1",
            "t1",
            "/tmp/claude-501/-x/sess/tasks/t1.output",
        );
        let out = kill_tasks_for_chat(KillTasksForChatArgs {
            chat_id: "c1",
            worktree_path: None,
            session: None,
            tracker: &tracker,
            spool_root: Some("/tmp/claude-501".to_string()),
        })
        .await;
        assert_eq!(
            out.failed,
            vec![FailedEntry {
                task_id: "t1".to_string(),
                error: "no live writer".to_string()
            }]
        );
        assert_eq!(
            tracker.get("c1", "t1").unwrap().status,
            BackgroundTaskStatus::Running
        );
    }

    // --- killTasksForChat (worktree sweep) — real temp spool fs ---

    /// The temp dirs (kept alive) + the spool-root / worktree paths for a sweep.
    struct SweepFixture {
        _spool: tempfile::TempDir,
        _worktree: tempfile::TempDir,
        spool_root: String,
        worktree_path: String,
    }

    /// Build `${spoolRoot}/{encoded(realpath(worktree))}/sess-a/tasks/leftover.output`.
    /// `make_symlink` swaps the file for a symlink.
    fn build_sweep_fixture(make_symlink: bool) -> SweepFixture {
        let spool = tempdir().unwrap();
        let worktree = tempdir().unwrap();
        let real_wt = std::fs::canonicalize(worktree.path()).unwrap();
        let encoded = encode_cwd_segment(&real_wt.to_string_lossy());
        let tasks = spool.path().join(&encoded).join("sess-a").join("tasks");
        fs::create_dir_all(&tasks).unwrap();
        let output = tasks.join("leftover.output");
        if make_symlink {
            let target = spool.path().join("target.txt");
            fs::write(&target, b"x").unwrap();
            std::os::unix::fs::symlink(&target, &output).unwrap();
        } else {
            fs::write(&output, b"x").unwrap();
        }
        SweepFixture {
            spool_root: spool.path().to_string_lossy().into_owned(),
            worktree_path: worktree.path().to_string_lossy().into_owned(),
            _spool: spool,
            _worktree: worktree,
        }
    }

    #[tokio::test(start_paused = true)]
    async fn worktree_sweep_rejects_symlinked_spool_files() {
        let _guard = seam_test_guard();
        let lsof_calls = Arc::new(Mutex::new(0usize));
        let lsof_calls2 = lsof_calls.clone();
        set_exec_for_tests(Arc::new(move |_c, _a| {
            *lsof_calls2.lock().unwrap_or_else(|p| p.into_inner()) += 1;
            Box::pin(async {
                Ok(ExecOk {
                    stdout: String::new(),
                })
            })
        }));
        record_tree_kill();
        let fx = build_sweep_fixture(true);
        let tracker = BackgroundTaskTracker::new();
        let out = kill_tasks_for_chat(KillTasksForChatArgs {
            chat_id: "c1",
            worktree_path: Some(&fx.worktree_path),
            session: None,
            tracker: &tracker,
            spool_root: Some(fx.spool_root.clone()),
        })
        .await;
        assert_eq!(*lsof_calls.lock().unwrap_or_else(|p| p.into_inner()), 0);
        assert!(out.swept.is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn worktree_sweep_kills_writer_pids_filters_daemon_pid() {
        let _guard = seam_test_guard();
        let daemon_pid = std::process::id();
        set_lsof_constant(vec![999, daemon_pid]);
        let tk = record_tree_kill();
        set_ps_comm_for_tests(Arc::new(|_pid| Box::pin(async { "ps".to_string() })));
        let fx = build_sweep_fixture(false);
        let tracker = BackgroundTaskTracker::new();
        let out = kill_tasks_for_chat(KillTasksForChatArgs {
            chat_id: "c1",
            worktree_path: Some(&fx.worktree_path),
            session: None,
            tracker: &tracker,
            spool_root: Some(fx.spool_root.clone()),
        })
        .await;
        let calls = tk_calls(&tk);
        assert!(calls.iter().any(|(p, _)| *p == 999));
        assert!(!calls.iter().any(|(p, _)| *p == daemon_pid));
        assert!(out.swept.iter().any(|s| s.pid == 999));
    }
}

// PORT STATUS: src/background-tasks/kill.ts (207 lines)
// confidence: high
// todos: 0
// notes: `tree-kill` npm dep has no allowlisted equivalent → real_tree_kill
// reimplements the POSIX algorithm (pgrep -P descendant enumeration + shell-out
// to `kill`, no libc). tree-kill + `ps -o comm=` are behind global seams
// (OnceLock<Mutex<KillSeam>>) so the TS module-mock tests translate; GRACE_MS
// setTimeout → tokio::time::sleep driven by `start_paused` tests (= fake timers).
// The worktree-sweep `onTask` callback → walk_spool_tasks Vec + loop, tested on a
// real temp spool fs (real file vs real symlink; real daemon pid filtered). All
// kill.test.ts + kill-tasks-for-chat.test.ts cases translated. `\u{0}`-packed
// tuple is a test-helper return shim (temp dirs must outlive the call).
