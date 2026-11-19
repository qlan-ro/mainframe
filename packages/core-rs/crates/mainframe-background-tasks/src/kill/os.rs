//! Process-tree signals and `ps` lookups, each behind a seam tests can swap.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use mainframe_runtime::ResolvedPath;
use mainframe_types::BoxFuture;
use mainframe_types::sync::LockExt;

use crate::lsof::lsof_writers;
use crate::process::ProcessDeps;

/// How long a tree gets between SIGTERM and SIGKILL.
const SIGKILL_GRACE: Duration = Duration::from_millis(800);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Signal {
    Sigterm,
    Sigkill,
}

/// A tree signal that did not reach every pid in the tree.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{detail}")]
pub(crate) struct TreeKillError {
    /// The root pid itself failed, not only some of its descendants.
    pub root_failed: bool,
    pub detail: String,
}

type TreeKillFn =
    Arc<dyn Fn(u32, Signal) -> BoxFuture<'static, Result<(), TreeKillError>> + Send + Sync>;
type PsCommFn = Arc<dyn Fn(u32) -> BoxFuture<'static, String> + Send + Sync>;

pub(crate) struct KillSeam {
    tree_kill: TreeKillFn,
    ps_comm: PsCommFn,
}

pub(crate) fn new_seam(path: ResolvedPath) -> Mutex<KillSeam> {
    let tree_path = path.clone();
    Mutex::new(KillSeam {
        tree_kill: Arc::new(move |pid, signal| {
            Box::pin(real_tree_kill(pid, signal, tree_path.clone()))
        }),
        ps_comm: Arc::new(move |pid| Box::pin(real_command_for_pid(pid, path.clone()))),
    })
}

#[cfg(test)]
pub(crate) fn set_tree_kill_for_tests(process: &ProcessDeps, tree_kill: TreeKillFn) {
    process.kill.lock_recover().tree_kill = tree_kill;
}

#[cfg(test)]
pub(crate) fn set_ps_comm_for_tests(process: &ProcessDeps, ps_comm: PsCommFn) {
    process.kill.lock_recover().ps_comm = ps_comm;
}

async fn tree_kill(process: &ProcessDeps, pid: u32, signal: Signal) -> Result<(), TreeKillError> {
    let tree_kill = process.kill.lock_recover().tree_kill.clone();
    tree_kill(pid, signal).await
}

async fn real_tree_kill(pid: u32, kind: Signal, path: ResolvedPath) -> Result<(), TreeKillError> {
    use mainframe_runtime::process::{Target, inspect, signal};
    let mut all = vec![pid];
    all.extend(inspect::descendants(pid, Some(&path)).await);
    let kind = match kind {
        Signal::Sigterm => mainframe_runtime::process::Signal::Term,
        Signal::Sigkill => mainframe_runtime::process::Signal::Kill,
    };
    signal_each(&all, |pid| signal(Target::Pid(pid), kind).map(|_| ()))
}

/// Signal every pid in `pids` (parent first), continuing past failures so one
/// EPERM never leaves the rest of the tree unsignalled; a pid already gone
/// (ESRCH) is not a failure. Only after every pid was tried does it report
/// the ones that failed, and whether the root (`pids[0]`) was among them, so
/// a caller can tell a surviving root from an unsignalled descendant.
pub(super) fn signal_each(
    pids: &[u32],
    mut send: impl FnMut(u32) -> std::io::Result<()>,
) -> Result<(), TreeKillError> {
    let mut root_failed = false;
    let failures: Vec<String> = pids
        .iter()
        .enumerate()
        .filter_map(|(index, &pid)| match send(pid) {
            Ok(()) => None,
            Err(error) => {
                tracing::warn!(pid, %error, "tree kill signal failed");
                root_failed |= index == 0;
                Some(format!("pid {pid}: {error}"))
            }
        })
        .collect();
    if failures.is_empty() {
        Ok(())
    } else {
        Err(TreeKillError {
            root_failed,
            detail: failures.join("; "),
        })
    }
}

/// SIGTERM the tree rooted at `pid`, wait, then SIGKILL it. The error is the
/// SIGKILL's: its `root_failed` says whether `pid` itself may have survived.
pub(super) async fn sigterm_then_kill(
    process: &ProcessDeps,
    pid: u32,
) -> Result<(), TreeKillError> {
    if let Err(error) = tree_kill(process, pid, Signal::Sigterm).await {
        tracing::warn!(pid, %error, "SIGTERM failed; trying SIGKILL");
    }
    tokio::time::sleep(SIGKILL_GRACE).await;
    tree_kill(process, pid, Signal::Sigkill).await
}

pub(super) async fn command_for_pid(process: &ProcessDeps, pid: u32) -> String {
    let ps_comm = process.kill.lock_recover().ps_comm.clone();
    ps_comm(pid).await
}

async fn real_command_for_pid(pid: u32, path: ResolvedPath) -> String {
    mainframe_runtime::process::inspect::command_name(pid, Some(&path))
        .await
        .unwrap_or_else(|| "unknown".to_string())
}

pub(super) enum SignalFailure {
    /// No process writes the file.
    NoWriter,
    Probe(crate::lsof::LsofError),
    /// These pids still write the file after being signalled.
    Survivors(Vec<u32>),
}

/// Kill every process writing `output_path`, then probe again to confirm
/// none survived.
pub(super) async fn signal_writers(
    process: &ProcessDeps,
    output_path: &str,
) -> Result<(), SignalFailure> {
    let writers = lsof_writers(process, output_path)
        .await
        .map_err(SignalFailure::Probe)?;
    if writers.is_empty() {
        return Err(SignalFailure::NoWriter);
    }
    for pid in writers {
        if let Err(error) = sigterm_then_kill(process, pid).await {
            tracing::warn!(pid, %error, "signalling a spool writer failed");
        }
    }
    let survivors = lsof_writers(process, output_path)
        .await
        .map_err(SignalFailure::Probe)?;
    if survivors.is_empty() {
        Ok(())
    } else {
        Err(SignalFailure::Survivors(survivors))
    }
}
