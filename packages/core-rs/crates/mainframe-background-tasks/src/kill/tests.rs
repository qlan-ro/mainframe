use super::*;
use crate::lsof::{ExecCode, ExecFn, ExecOk, LsofExecError, set_exec_for_tests};
use crate::tracker::TaskSeed;
use mainframe_types::background_task::{BackgroundTaskToolName, BackgroundWorkKind};
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

fn set_lsof_queue(tracker: &BackgroundTaskTracker, responses: Vec<Canned>) {
    let q = Arc::new(Mutex::new(VecDeque::from(responses)));
    let exec: ExecFn = Arc::new(move |_c, _a| {
        let item = q.lock_recover().pop_front();
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
    set_exec_for_tests(&tracker.process, exec);
}

fn set_lsof_constant(tracker: &BackgroundTaskTracker, pids: Vec<u32>) {
    let stdout = writers_stdout(&pids);
    set_exec_for_tests(
        &tracker.process,
        Arc::new(move |_c, _a| {
            let stdout = stdout.clone();
            Box::pin(async move { Ok(ExecOk { stdout }) })
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
    fn stop_background_task<'a>(
        &'a self,
        _task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = StopResult> + Send + 'a>> {
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

// --- killBackgroundTask ---

// --- killTasksForChat (CLI + OS, no sweep) ---

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

mod cases_0;

mod cases_1;
