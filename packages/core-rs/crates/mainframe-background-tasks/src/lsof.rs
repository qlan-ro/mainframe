//! Ported from `packages/core/src/background-tasks/lsof.ts`.

use std::future::Future;
use std::pin::Pin;
use std::process::Stdio;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use tokio::process::Command;

/// An `execFile` rejection `code`: `number | string` in TS.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecCode {
    Number(i64),
    Text(String),
}

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
/// `promisify(execFile)` shape: `(cmd, args) -> Promise<{ stdout }>`.
pub type ExecFn = Arc<dyn Fn(String, Vec<String>) -> ExecFuture + Send + Sync>;
pub type WarnFn = Arc<dyn Fn(&str) + Send + Sync>;

const TIMEOUT_MS: u64 = 2000;

struct Seam {
    exec: ExecFn,
    logger: WarnFn,
    warned_missing: bool,
}

fn default_exec() -> ExecFn {
    Arc::new(|cmd: String, args: Vec<String>| Box::pin(real_exec(cmd, args)) as ExecFuture)
}

fn default_logger() -> WarnFn {
    Arc::new(|msg: &str| tracing::warn!(target: "background-tasks:lsof", "{msg}"))
}

fn seam() -> &'static Mutex<Seam> {
    static SEAM: OnceLock<Mutex<Seam>> = OnceLock::new();
    SEAM.get_or_init(|| {
        Mutex::new(Seam {
            exec: default_exec(),
            logger: default_logger(),
            warned_missing: false,
        })
    })
}

fn lock_seam() -> MutexGuard<'static, Seam> {
    seam()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Test-only seam (also resets the ENOENT warn-once latch).
pub fn set_exec_for_tests(fn_: ExecFn) {
    let mut g = lock_seam();
    g.exec = fn_;
    g.warned_missing = false;
}

/// Test-only seam — swap the logger so warn calls are observable.
pub fn set_logger_for_tests(logger: WarnFn) {
    let mut g = lock_seam();
    g.logger = logger;
    g.warned_missing = false;
}

/// The default `_exec` — run `lsof -F pan -- <path>` with a 2s timeout.
async fn real_exec(cmd: String, args: Vec<String>) -> Result<ExecOk, LsofExecError> {
    let mut command = Command::new(&cmd);
    command
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::spawn_env::apply(&mut command);

    let child = match command.spawn() {
        Ok(child) => child,
        Err(err) => {
            let code = if err.kind() == std::io::ErrorKind::NotFound {
                Some(ExecCode::Text("ENOENT".to_string()))
            } else {
                None
            };
            return Err(LsofExecError {
                code,
                signal: None,
                stdout: None,
            });
        }
    };

    let output =
        match tokio::time::timeout(Duration::from_millis(TIMEOUT_MS), child.wait_with_output())
            .await
        {
            Ok(Ok(output)) => output,
            // execFile timeout kills the child and rejects with a SIGTERM signal.
            Err(_elapsed) => {
                return Err(LsofExecError {
                    code: None,
                    signal: Some("SIGTERM".to_string()),
                    stdout: None,
                });
            }
            Ok(Err(err)) => {
                return Err(LsofExecError {
                    code: Some(ExecCode::Text(err.to_string())),
                    signal: None,
                    stdout: None,
                });
            }
        };

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

async fn run_lsof(path: &str) -> Result<String, String> {
    let exec = lock_seam().exec.clone();
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
                // Liveness ticks fire once per task per minute. Warn once per
                // process to keep logs sane.
                let mut g = lock_seam();
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

fn parse_pids(stdout: &str, accept: impl Fn(&str) -> bool) -> Vec<u32> {
    let mut pids: Vec<u32> = Vec::new();
    let mut pending_pid: Option<u32> = None;
    for line in stdout.split('\n') {
        if line.is_empty() {
            continue;
        }
        let mut chars = line.chars();
        let tag = chars.next().unwrap_or('\0');
        let rest = &line[tag.len_utf8()..];
        if tag == 'p' {
            pending_pid = match rest.parse::<i64>() {
                Ok(n) if n > 0 => u32::try_from(n).ok(),
                _ => None,
            };
        } else if tag == 'a'
            && let Some(pid) = pending_pid
        {
            if accept(rest) {
                pids.push(pid);
            }
            pending_pid = None;
        }
    }
    pids
}

pub async fn lsof_writers_detailed(path: &str) -> Result<Vec<u32>, String> {
    let stdout = run_lsof(path).await?;
    Ok(parse_pids(&stdout, |m| m == "w" || m == "u"))
}

pub async fn lsof_writers(path: &str) -> Vec<u32> {
    lsof_writers_detailed(path).await.unwrap_or_default()
}

pub async fn lsof_any(path: &str) -> Vec<u32> {
    match run_lsof(path).await {
        Ok(stdout) => parse_pids(&stdout, |_| true),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::seam_test_guard;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn ok_exec(stdout: &'static str) -> ExecFn {
        Arc::new(move |_cmd, _args| {
            Box::pin(async move {
                Ok(ExecOk {
                    stdout: stdout.to_string(),
                })
            }) as ExecFuture
        })
    }

    fn fail_exec(err: LsofExecError) -> ExecFn {
        Arc::new(move |_cmd, _args| {
            let err = err.clone();
            Box::pin(async move { Err(err) }) as ExecFuture
        })
    }

    #[tokio::test]
    async fn parses_write_mode_fds_only() {
        let _guard = seam_test_guard();
        set_exec_for_tests(ok_exec("p1234\naw\nn/p\np5678\nar\nn/p\np9012\nau\nn/p\n"));
        assert_eq!(lsof_writers_detailed("/p").await, Ok(vec![1234, 9012]));
    }

    #[tokio::test]
    async fn exit_code_1_is_ok_empty() {
        let _guard = seam_test_guard();
        set_exec_for_tests(fail_exec(LsofExecError {
            code: Some(ExecCode::Number(1)),
            signal: None,
            stdout: Some(String::new()),
        }));
        assert_eq!(lsof_writers_detailed("/p").await, Ok(vec![]));
    }

    #[tokio::test]
    async fn enoent_is_not_ok() {
        let _guard = seam_test_guard();
        set_exec_for_tests(fail_exec(LsofExecError {
            code: Some(ExecCode::Text("ENOENT".to_string())),
            signal: None,
            stdout: None,
        }));
        let r = lsof_writers_detailed("/p").await;
        assert!(r.is_err());
        assert!(r.unwrap_err().to_lowercase().contains("lsof"));
    }

    #[tokio::test]
    async fn exit_code_2_is_not_ok() {
        let _guard = seam_test_guard();
        set_exec_for_tests(fail_exec(LsofExecError {
            code: Some(ExecCode::Number(2)),
            signal: None,
            stdout: None,
        }));
        assert!(lsof_writers_detailed("/p").await.is_err());
    }

    #[tokio::test]
    async fn timeout_signal_is_not_ok() {
        let _guard = seam_test_guard();
        set_exec_for_tests(fail_exec(LsofExecError {
            code: None,
            signal: Some("SIGTERM".to_string()),
            stdout: None,
        }));
        assert!(lsof_writers_detailed("/p").await.is_err());
    }

    #[tokio::test]
    async fn rejects_non_numeric_pids_defensively() {
        let _guard = seam_test_guard();
        set_exec_for_tests(ok_exec("pabc\naw\nn/p\np42\naw\nn/p\n"));
        assert_eq!(lsof_writers_detailed("/p").await, Ok(vec![42]));
    }

    #[tokio::test]
    async fn writers_returns_empty_when_unavailable() {
        let _guard = seam_test_guard();
        set_exec_for_tests(fail_exec(LsofExecError {
            code: Some(ExecCode::Text("ENOENT".to_string())),
            signal: None,
            stdout: None,
        }));
        assert_eq!(lsof_writers("/p").await, Vec::<u32>::new());
    }

    #[tokio::test]
    async fn writers_returns_pids_on_success() {
        let _guard = seam_test_guard();
        set_exec_for_tests(ok_exec("p7\naw\nn/p\n"));
        assert_eq!(lsof_writers("/p").await, vec![7]);
    }

    #[tokio::test]
    async fn any_returns_pids_regardless_of_access_mode() {
        let _guard = seam_test_guard();
        set_exec_for_tests(ok_exec("p1\nar\nn/p\np2\naw\nn/p\n"));
        assert_eq!(lsof_any("/p").await, vec![1, 2]);
    }

    #[tokio::test]
    async fn only_logs_warn_once_across_repeated_enoent_calls() {
        let _guard = seam_test_guard();
        set_exec_for_tests(fail_exec(LsofExecError {
            code: Some(ExecCode::Text("ENOENT".to_string())),
            signal: None,
            stdout: None,
        })); // also resets warned_missing
        let count = Arc::new(AtomicUsize::new(0));
        let count2 = count.clone();
        set_logger_for_tests(Arc::new(move |_msg: &str| {
            count2.fetch_add(1, Ordering::SeqCst);
        }));
        let r1 = lsof_writers_detailed("/p").await;
        let r2 = lsof_writers_detailed("/p").await;
        assert!(r1.is_err());
        assert!(r2.is_err());
        assert_eq!(count.load(Ordering::SeqCst), 1);
        // Restore the default logger so later tests don't inherit the counter.
        set_logger_for_tests(default_logger());
    }
}

// PORT STATUS: src/background-tasks/lsof.ts (90 lines)
// confidence: high
// todos: 0
// notes: module-level `_exec`/`_log`/`warnedMissing` seams → OnceLock<Mutex<Seam>>
// (no static mut / lazy_static). `__setExecForTests`/`__setLoggerForTests` →
// set_exec_for_tests/set_logger_for_tests (both reset warned_missing, as TS).
// Real `_exec` runs the exact `lsof -F pan -- <path>` argv with a 2s timeout
// (kill_on_drop). Seam lock is never held across `.await`. lsofWritersDetailed's
// `{ok,pids}|{ok,error}` union → Result<Vec<u32>,String>. Tests serialize on the
// crate seam guard (parallel test threads share the global). All lsof.test.ts
// cases translated, incl. warn-once.
