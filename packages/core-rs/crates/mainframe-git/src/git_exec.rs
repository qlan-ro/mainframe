//! The single subprocess primitive: run git in a directory and return stdout.
//! Arguments are passed as an array (no shell). A failed run keeps git's
//! captured streams so callers can classify the failure.

use mainframe_runtime::process::{ExecError, run_captured};
use std::time::Duration;

use tokio::process::Command;

/// How long [`exec_git`] lets git run before killing it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum GitTimeout {
    /// 30 seconds, enough for the local read and parse commands most callers run.
    #[default]
    Default,
    After(Duration),
    /// No limit, for network operations (fetch, pull, push) that can run long.
    Unbounded,
}

impl GitTimeout {
    const DEFAULT: Duration = Duration::from_secs(30);

    fn duration(self) -> Option<Duration> {
        match self {
            Self::Default => Some(Self::DEFAULT),
            Self::After(duration) => Some(duration),
            Self::Unbounded => None,
        }
    }
}

/// Why a git run failed. The `Display` text reaches API clients through the
/// git routes' error envelopes, so keep it stable.
#[derive(Debug, Clone, thiserror::Error)]
pub enum GitExecError {
    #[error("Directory not accessible: {cwd}")]
    DirectoryNotAccessible { cwd: String },
    #[error("Command failed: git {command} timed out")]
    TimedOut { command: String },
    /// git could not be started, or its output could not be collected.
    #[error("{0}")]
    Spawn(String),
    /// git ran and exited non-zero. The message embeds stderr, which carries
    /// the text callers classify on ("non-fast-forward", "not fully merged").
    #[error("Command failed: git {command}\n{stderr}")]
    Failed {
        command: String,
        code: Option<i32>,
        stderr: String,
    },
}

impl GitExecError {
    /// git's stderr for a run that exited non-zero; empty for every other failure.
    pub fn stderr(&self) -> &str {
        match self {
            Self::Failed { stderr, .. } => stderr,
            _ => "",
        }
    }
}

/// Runs `git <args>` in `cwd` and returns its stdout.
pub async fn exec_git<S: AsRef<str>>(
    args: &[S],
    cwd: &str,
    timeout: GitTimeout,
) -> Result<String, GitExecError> {
    if tokio::fs::metadata(cwd).await.is_err() {
        return Err(GitExecError::DirectoryNotAccessible {
            cwd: cwd.to_string(),
        });
    }

    let args: Vec<&str> = args.iter().map(AsRef::as_ref).collect();
    let mut cmd = Command::new("git");
    cmd.args(&args).current_dir(cwd);
    let output = run_captured(cmd, timeout.duration())
        .await
        .map_err(|error| match error {
            ExecError::Timeout => GitExecError::TimedOut {
                command: args.join(" "),
            },
            error => GitExecError::Spawn(error.to_string()),
        })?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    Err(GitExecError::Failed {
        command: args.join(" "),
        code: output.status.code(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}
