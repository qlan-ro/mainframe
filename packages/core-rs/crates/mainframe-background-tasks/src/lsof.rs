//! `lsof` probes: which processes hold a spool file open for writing.

use std::process::Output;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use mainframe_runtime::ResolvedPath;
use mainframe_runtime::process::inspect::parse_pids;
use mainframe_runtime::process::{ExecError, run_captured};
use mainframe_types::BoxFuture;
use mainframe_types::sync::LockExt as _;
use tokio::process::Command;

use crate::process::ProcessDeps;

const TIMEOUT: Duration = Duration::from_secs(2);

/// Why an `lsof` probe gave no answer. Callers log and skip: a failed probe
/// never marks a task stopped.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub(crate) enum LsofError {
    #[error("lsof not installed")]
    NotInstalled,
    #[error("lsof timed out")]
    TimedOut,
    #[error("lsof exited with code {0}")]
    Exited(i32),
    #[error("lsof was killed by a signal")]
    Killed,
    #[error("lsof failed: {0}")]
    Failed(String),
}

/// Runs `lsof -F pan -- <path>` and returns its stdout.
pub(crate) type LsofFn =
    Arc<dyn Fn(String) -> BoxFuture<'static, Result<String, LsofError>> + Send + Sync>;

pub(crate) fn real_lsof(path: ResolvedPath) -> LsofFn {
    Arc::new(move |file| {
        let mut command = Command::new("lsof");
        command.args(["-F", "pan", "--"]).arg(file);
        path.apply(&mut command);
        Box::pin(async move { lsof_stdout(run_captured(command, Some(TIMEOUT)).await) })
    })
}

/// lsof exits 1 when no process has the file open: an empty answer, not a
/// failure.
fn lsof_stdout(result: Result<Output, ExecError>) -> Result<String, LsofError> {
    let output = result.map_err(|error| match error {
        ExecError::Spawn(error) if error.kind() == std::io::ErrorKind::NotFound => {
            LsofError::NotInstalled
        }
        ExecError::Timeout => LsofError::TimedOut,
        error => LsofError::Failed(error.to_string()),
    })?;
    match output.status.code() {
        Some(0 | 1) => Ok(String::from_utf8_lossy(&output.stdout).into_owned()),
        Some(code) => Err(LsofError::Exited(code)),
        None => Err(LsofError::Killed),
    }
}

#[cfg(test)]
pub(crate) fn set_lsof_for_tests(process: &ProcessDeps, lsof: LsofFn) {
    *process.lsof.lock_recover() = lsof;
}

async fn run_lsof(process: &ProcessDeps, path: &str) -> Result<String, LsofError> {
    let lsof = process.lsof.lock_recover().clone();
    let result = lsof(path.to_string()).await;
    if result == Err(LsofError::NotInstalled)
        && !process.lsof_missing_warned.swap(true, Ordering::Relaxed)
    {
        tracing::warn!(
            reason = "lsof_missing",
            "lsof binary not found; background-task OS fallbacks disabled"
        );
    }
    result
}

/// Pids holding `path` open for writing (`w`) or read-write (`u`).
pub(crate) async fn lsof_writers_detailed(
    process: &ProcessDeps,
    path: &str,
) -> Result<Vec<u32>, LsofError> {
    let stdout = run_lsof(process, path).await?;
    Ok(parse_pids(&stdout, |mode| mode == "w" || mode == "u"))
}

/// [`lsof_writers_detailed`], treating a failed probe as no writers.
pub(crate) async fn lsof_writers(process: &ProcessDeps, path: &str) -> Vec<u32> {
    lsof_writers_detailed(process, path)
        .await
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "lsof_tests.rs"]
mod tests;
