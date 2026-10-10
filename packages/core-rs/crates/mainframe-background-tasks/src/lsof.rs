use mainframe_types::sync::LockExt as _;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use tokio::process::Command;

/// An exec failure `code`: numeric or textual.
pub use mainframe_runtime::process::ExecCode;

fn code_display(code: &Option<ExecCode>) -> String {
    match code {
        Some(ExecCode::Number(n)) => n.to_string(),
        Some(ExecCode::Text(t)) => t.clone(),
        None => "undefined".to_string(),
    }
}

/// A successful exec result (`{ stdout }`).
#[derive(Debug, Clone)]
pub struct ExecOk {
    pub stdout: String,
}

/// An exec rejection carrying the fields runLsof inspects (`code`/`signal`/`stdout`).
#[derive(Debug, Clone)]
pub struct LsofExecError {
    pub code: Option<ExecCode>,
    pub signal: Option<String>,
    pub stdout: Option<String>,
}

type ExecFuture = Pin<Box<dyn Future<Output = Result<ExecOk, LsofExecError>> + Send>>;
/// Exec seam: `(cmd, args)` resolving to the captured stdout.
pub type ExecFn = Arc<dyn Fn(String, Vec<String>) -> ExecFuture + Send + Sync>;
pub type WarnFn = Arc<dyn Fn(&str) + Send + Sync>;

const TIMEOUT_MS: u64 = 2000;

pub(crate) struct Seam {
    exec: ExecFn,
    logger: WarnFn,
    warned_missing: bool,
}

fn default_exec(path: mainframe_runtime::ResolvedPath) -> ExecFn {
    Arc::new(move |cmd, args| Box::pin(real_exec(cmd, args, path.clone())))
}

fn default_logger() -> WarnFn {
    Arc::new(|msg: &str| tracing::warn!(target: "background-tasks:lsof", "{msg}"))
}

pub(crate) fn new_seam(path: mainframe_runtime::ResolvedPath) -> Mutex<Seam> {
    Mutex::new(Seam {
        exec: default_exec(path),
        logger: default_logger(),
        warned_missing: false,
    })
}

fn lock_seam(process: &crate::process::ProcessDeps) -> MutexGuard<'_, Seam> {
    process.lsof.lock_recover()
}

/// Test-only seam (also resets the ENOENT warn-once latch).
#[cfg(test)]
pub(crate) fn set_exec_for_tests(process: &crate::process::ProcessDeps, fn_: ExecFn) {
    let mut g = lock_seam(process);
    g.exec = fn_;
    g.warned_missing = false;
}

/// Test-only seam — swap the logger so warn calls are observable.
#[cfg(test)]
pub(crate) fn set_logger_for_tests(process: &crate::process::ProcessDeps, logger: WarnFn) {
    let mut g = lock_seam(process);
    g.logger = logger;
    g.warned_missing = false;
}

/// The default `_exec` — run `lsof -F pan -- <path>` with a 2s timeout.
async fn real_exec(
    cmd: String,
    args: Vec<String>,
    path: mainframe_runtime::ResolvedPath,
) -> Result<ExecOk, LsofExecError> {
    use mainframe_runtime::process::{ExecError, run_captured};
    let mut command = Command::new(&cmd);
    command.args(&args);
    path.apply(&mut command);
    let output = run_captured(command, Some(Duration::from_millis(TIMEOUT_MS)))
        .await
        .map_err(|error| {
            let (code, signal) = match error {
                ExecError::Timeout => (None, Some("SIGTERM".to_string())),
                ExecError::Spawn(error) => (
                    (error.kind() == std::io::ErrorKind::NotFound)
                        .then(|| ExecCode::Text("ENOENT".to_string())),
                    None,
                ),
                error => (Some(ExecCode::Text(error.to_string())), None),
            };
            LsofExecError {
                code,
                signal,
                stdout: None,
            }
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    if output.status.success() {
        Ok(ExecOk { stdout })
    } else {
        Err(LsofExecError {
            code: output.status.code().map(|c| ExecCode::Number(c as i64)),
            signal: None,
            stdout: Some(stdout),
        })
    }
}

async fn run_lsof(process: &crate::process::ProcessDeps, path: &str) -> Result<String, String> {
    let exec = lock_seam(process).exec.clone();
    let result = exec(
        "lsof".to_string(),
        vec![
            "-F".to_string(),
            "pan".to_string(),
            "--".to_string(),
            path.to_string(),
        ],
    )
    .await;
    match result {
        Ok(ok) => Ok(ok.stdout),
        Err(e) => {
            // lsof returns 1 when there are no matches — a clean "empty", not a failure.
            if e.code == Some(ExecCode::Number(1)) {
                return Ok(e.stdout.unwrap_or_default());
            }
            if e.code == Some(ExecCode::Text("ENOENT".to_string())) {
                // Share the missing-tool warning across this tracker's liveness ticks.
                let mut g = lock_seam(process);
                if !g.warned_missing {
                    (g.logger)("lsof binary not found; background-task OS fallbacks disabled");
                    g.warned_missing = true;
                }
                return Err("lsof not installed".to_string());
            }
            if let Some(signal) = e.signal {
                return Err(format!("lsof killed by signal {signal}"));
            }
            Err(format!("lsof exited code={}", code_display(&e.code)))
        }
    }
}

use mainframe_runtime::process::inspect::parse_pids;

pub(crate) async fn lsof_writers_detailed(
    process: &crate::process::ProcessDeps,
    path: &str,
) -> Result<Vec<u32>, String> {
    let stdout = run_lsof(process, path).await?;
    Ok(parse_pids(&stdout, |m| m == "w" || m == "u"))
}

pub(crate) async fn lsof_writers(process: &crate::process::ProcessDeps, path: &str) -> Vec<u32> {
    lsof_writers_detailed(process, path)
        .await
        .unwrap_or_default()
}

#[cfg(test)]
pub(crate) async fn lsof_any(process: &crate::process::ProcessDeps, path: &str) -> Vec<u32> {
    match run_lsof(process, path).await {
        Ok(stdout) => parse_pids(&stdout, |_| true),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests;
