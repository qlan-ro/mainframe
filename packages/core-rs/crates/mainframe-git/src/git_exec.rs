//! The single subprocess primitive: run a git command in `cwd` and return
//! stdout. Array args (no shell), a 30s default timeout for the fast read/parse
//! commands, and `timeout: 0` for genuinely long-running network ops (0 = no
//! timeout). On a non-zero exit the error carries
//! `stdout`/`stderr`/`code` so callers can classify failures.

use mainframe_runtime::process::{ExecError, run_captured};
use std::time::Duration;

use tokio::process::Command;

/// The `timeout` option for [`exec_git`] (milliseconds; `0` = uncapped).
///
/// When the whole value is absent the default 30s applies; a present `Some(0)` means no timeout.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GitExecOptions {
    pub timeout: Option<u64>,
}

/// The `code` an [`GitExecError`] carries — git exits with a numeric status, but
/// timeouts/spawn failures surface as a string.
pub use mainframe_runtime::process::ExecCode as GitExecCode;

/// A failed git run, carrying the captured streams git wrote before exiting
/// (`code`/`stdout`/`stderr`).
#[derive(Debug, Clone, thiserror::Error)]
#[error("{message}")]
pub struct GitExecError {
    pub message: String,
    pub code: Option<GitExecCode>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
}

/// Runs a git command in `cwd` and returns stdout.
///
/// Array args (no shell), a 30s default
/// timeout suited to the fast read/parse commands most callers issue, and
/// `timeout: 0` for genuinely long-running operations. On a non-zero exit the
/// error carries `stdout`/`stderr`/`code` so callers can classify failures
/// (merge conflicts, rejected pushes).
pub async fn exec_git(
    args: &[String],
    cwd: &str,
    opts: Option<GitExecOptions>,
) -> Result<String, GitExecError> {
    // `await access(cwd)` — reject with code 128 when the dir is not reachable.
    if tokio::fs::metadata(cwd).await.is_err() {
        return Err(GitExecError {
            message: format!("Directory not accessible: {cwd}"),
            code: Some(GitExecCode::Number(128)),
            stdout: None,
            stderr: None,
        });
    }

    let timeout_ms = opts.and_then(|o| o.timeout).unwrap_or(30_000);

    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(cwd);
    let timeout = (timeout_ms != 0).then(|| Duration::from_millis(timeout_ms));
    let output = run_captured(cmd, timeout)
        .await
        .map_err(|error| match error {
            ExecError::Timeout => GitExecError {
                message: format!("Command failed: git {} timed out", args.join(" ")),
                code: Some(GitExecCode::Text("ETIMEDOUT".to_string())),
                stdout: None,
                stderr: None,
            },
            error => GitExecError {
                message: error.to_string(),
                code: None,
                stdout: None,
                stderr: None,
            },
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    if output.status.success() {
        Ok(stdout)
    } else {
        let code = output.status.code().map(|c| GitExecCode::Number(c as i64));
        // The error message embeds stderr; classification callers
        // (`.contains("non-fast-forward")`, `"not fully merged"`, …) rely on it.
        let message = format!("Command failed: git {}\n{}", args.join(" "), stderr);
        Err(GitExecError {
            message,
            code,
            stdout: Some(stdout),
            stderr: Some(stderr),
        })
    }
}
