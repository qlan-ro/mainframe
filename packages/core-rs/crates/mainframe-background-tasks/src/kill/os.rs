use super::{GRACE_MS, StopResult};
use crate::lsof::lsof_writers;
use mainframe_types::sync::LockExt;
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

// --- process-signalling seams (tree-kill + `ps -o comm=`) ---

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Signal {
    Sigterm,
    Sigkill,
}

type TreeKillFuture = Pin<Box<dyn Future<Output = Result<(), String>> + Send>>;
type TreeKillFn = Arc<dyn Fn(u32, Signal) -> TreeKillFuture + Send + Sync>;
type PsCommFuture = Pin<Box<dyn Future<Output = String> + Send>>;
type PsCommFn = Arc<dyn Fn(u32) -> PsCommFuture + Send + Sync>;

pub struct KillSeam {
    tree_kill: TreeKillFn,
    ps_comm: PsCommFn,
}

pub fn new_seam(path: mainframe_runtime::ResolvedPath) -> Mutex<KillSeam> {
    let tree_path = path.clone();
    Mutex::new(KillSeam {
        tree_kill: Arc::new(move |pid, signal| {
            Box::pin(real_tree_kill(pid, signal, tree_path.clone()))
        }),
        ps_comm: Arc::new(move |pid| Box::pin(real_command_for_pid(pid, path.clone()))),
    })
}

fn lock_kill_seam(process: &crate::process::ProcessDeps) -> MutexGuard<'_, KillSeam> {
    process.kill.lock_recover()
}

/// Test-only seam — swap the tree-kill implementation.
#[cfg(test)]
pub(crate) fn set_tree_kill_for_tests(process: &crate::process::ProcessDeps, fn_: TreeKillFn) {
    lock_kill_seam(process).tree_kill = fn_;
}

/// Test-only seam — swap the `ps -o comm=` implementation.
#[cfg(test)]
pub(crate) fn set_ps_comm_for_tests(process: &crate::process::ProcessDeps, fn_: PsCommFn) {
    lock_kill_seam(process).ps_comm = fn_;
}

async fn tree_kill(
    process: &crate::process::ProcessDeps,
    pid: u32,
    signal: Signal,
) -> Result<(), String> {
    let f = lock_kill_seam(process).tree_kill.clone();
    f(pid, signal).await
}

async fn real_tree_kill(
    pid: u32,
    kind: Signal,
    path: mainframe_runtime::ResolvedPath,
) -> Result<(), String> {
    use mainframe_runtime::process::{Target, inspect, signal};
    let mut all = vec![pid];
    all.extend(inspect::descendants(pid, Some(&path)).await);
    let kind = match kind {
        Signal::Sigterm => mainframe_runtime::process::Signal::Term,
        Signal::Sigkill => mainframe_runtime::process::Signal::Kill,
    };
    for pid in all {
        signal(Target::Pid(pid), kind).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(super) async fn sigterm_then_kill(
    process: &crate::process::ProcessDeps,
    pid: u32,
) -> StopResult {
    if let Err(sig_err) = tree_kill(process, pid, Signal::Sigterm).await {
        tracing::warn!(target: "background-tasks:kill", pid, err = %sig_err, "SIGTERM failed; trying SIGKILL");
    }
    tokio::time::sleep(Duration::from_millis(GRACE_MS)).await;
    match tree_kill(process, pid, Signal::Sigkill).await {
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

pub(super) async fn command_for_pid(process: &crate::process::ProcessDeps, pid: u32) -> String {
    let f = lock_kill_seam(process).ps_comm.clone();
    f(pid).await
}

async fn real_command_for_pid(pid: u32, path: mainframe_runtime::ResolvedPath) -> String {
    mainframe_runtime::process::inspect::command_name(pid, Some(&path))
        .await
        .unwrap_or_else(|| "unknown".to_string())
}

/// The reason a `killOneTaskOS` attempt did not signal a live writer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum OsKillReason {
    NoOutputPath,
    NoWriter,
    Survivors,
}

pub(super) enum OsKillOutcome {
    Ok,
    Err { reason: OsKillReason, error: String },
}

/// OS-level kill for a single task: identify writers via lsof, signal them, then
/// re-check there are no survivors.
pub(super) async fn kill_one_task_os<S, SFut>(
    process: &crate::process::ProcessDeps,
    output_path: Option<&str>,
    signaller: S,
) -> OsKillOutcome
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
    let writers = lsof_writers(process, output_path).await;
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
    let remaining = lsof_writers(process, output_path).await;
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
