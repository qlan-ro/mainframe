use super::chat::kill_tasks_for_chat_under;
use super::os::{Signal, set_ps_comm_for_tests, set_tree_kill_for_tests};
use super::*;
use crate::encoding::encode_cwd_segment;
use crate::lsof::{LsofFn, set_lsof_for_tests};
use crate::tracker::TaskSeed;
use mainframe_types::background_task::{BackgroundTaskToolName, BackgroundWorkKind};
use mainframe_types::sync::LockExt as _;
use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
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

fn set_lsof_queue(tracker: &BackgroundTaskTracker, responses: Vec<Canned>) {
    let q = Arc::new(Mutex::new(VecDeque::from(responses)));
    let lsof: LsofFn = Arc::new(move |_path| {
        let stdout = match q.lock_recover().pop_front() {
            Some(Canned::Writers(pids)) => writers_stdout(&pids),
            Some(Canned::Empty) | None => String::new(),
        };
        Box::pin(async move { Ok(stdout) })
    });
    set_lsof_for_tests(&tracker.process, lsof);
}

fn set_lsof_constant(tracker: &BackgroundTaskTracker, pids: Vec<u32>) {
    let stdout = writers_stdout(&pids);
    set_lsof_for_tests(
        &tracker.process,
        Arc::new(move |_path| {
            let stdout = stdout.clone();
            Box::pin(async move { Ok(stdout) })
        }),
    );
}

/// tree-kill stub that records (pid, signal) and succeeds. Returns the log.
fn record_tree_kill(tracker: &BackgroundTaskTracker) -> Arc<Mutex<Vec<(u32, Signal)>>> {
    let log = Arc::new(Mutex::new(Vec::new()));
    let log2 = log.clone();
    set_tree_kill_for_tests(
        &tracker.process,
        Arc::new(move |pid, signal| {
            log2.lock_recover().push((pid, signal));
            Box::pin(async { Ok(()) })
        }),
    );
    log
}

fn tk_calls(log: &Arc<Mutex<Vec<(u32, Signal)>>>) -> Vec<(u32, Signal)> {
    log.lock_recover().clone()
}

struct MockSession {
    result: StopResult,
    called: Arc<Mutex<bool>>,
}
impl SessionLike for MockSession {
    fn stop_background_task<'a>(&'a self, _task_id: &'a str) -> BoxFuture<'a, StopResult> {
        *self.called.lock_recover() = true;
        let r = self.result.clone();
        Box::pin(async move { r })
    }
}

fn seed(tracker: &BackgroundTaskTracker, chat: &str, id: &str, output_path: &str) {
    tracker.start(
        chat,
        TaskSeed {
            id: id.to_string(),
            kind: BackgroundWorkKind::Bash,
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: "u".to_string(),
            command: "x".to_string(),
            description: String::new(),
            workflow_name: None,
        },
        output_path.to_string(),
    );
}

/// The temp dirs (kept alive) and the spool-root and worktree paths for a
/// sweep.
struct SweepFixture {
    _spool: tempfile::TempDir,
    _worktree: tempfile::TempDir,
    spool_root: String,
    worktree_path: String,
}

/// Run `kill_tasks_for_chat` for chat `c1` against a test spool root.
async fn kill_chat(
    tracker: &BackgroundTaskTracker,
    session: Option<&dyn SessionLike>,
    worktree_path: Option<&str>,
    spool_root: &str,
) -> KillTasksForChatResult {
    kill_tasks_for_chat_under(
        KillTasksForChatArgs {
            chat_id: "c1",
            worktree_path,
            session,
            tracker,
        },
        Path::new(spool_root),
    )
    .await
}

/// Build `<spool_root>/<encoded real worktree>/sess-a/tasks/leftover.output`.
/// `make_symlink` makes the output a symlink instead of a file.
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

#[path = "kill_tests_kill_chat.rs"]
mod kill_chat;
#[path = "kill_tests_kill_task.rs"]
mod kill_task;
#[path = "kill_tests_tree_signal.rs"]
mod tree_signal;
#[path = "kill_tests_worktree_sweep.rs"]
mod worktree_sweep;
