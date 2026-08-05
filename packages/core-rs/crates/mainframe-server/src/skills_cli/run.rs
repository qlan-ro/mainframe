//! The real [`SkillsCliRunner`] (spawns `skills`/`npx`), ANSI stripping, tail
//! extraction, and the outcome-to-`Result` mapping shared by all four
//! `mod.rs` entry points.

use std::process::Stdio;
use std::time::Duration;

use mainframe_runtime::ResolvedPath;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::task::JoinHandle;

use super::{BoxFuture, CliOutcome, CommandSpec, SkillsCliError, SkillsCliRunner};

/// Install/uninstall timeout: `npx skills` on a cold `npm` cache can take
/// minutes.
pub const INSTALL_TIMEOUT_MS: u64 = 180_000;
/// Manifest/probe timeout — both are read-only, fast operations.
pub const READ_TIMEOUT_MS: u64 = 60_000;
/// Chars kept from the ANSI-stripped output tail on a failure response.
pub const TAIL_CHARS: usize = 4_000;

const MAX_CAPTURE_BYTES: usize = 256 * 1024;

/// Spawns `skills`/`npx` with the boot-resolved `PATH`, stdin closed, capped
/// output and a timeout — mirrors `mainframe-automations`'s
/// `actions/shell.rs` capture idiom.
pub struct ProcessRunner {
    path: ResolvedPath,
}

impl ProcessRunner {
    #[must_use]
    pub fn new(path: ResolvedPath) -> Self {
        Self { path }
    }
}

impl SkillsCliRunner for ProcessRunner {
    fn run(&self, spec: CommandSpec, timeout_ms: u64) -> BoxFuture<'_, CliOutcome> {
        let path = self.path.as_str().to_string();
        Box::pin(async move { spawn_and_capture(spec, timeout_ms, &path).await })
    }
}

async fn spawn_and_capture(spec: CommandSpec, timeout_ms: u64, path: &str) -> CliOutcome {
    let mut child = match spawn_child(&spec, path) {
        Ok(child) => child,
        Err(err) => {
            tracing::warn!(program = %spec.program, %err, "skills CLI failed to spawn");
            return CliOutcome {
                started: false,
                timed_out: false,
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
            };
        }
    };

    let stdout = spawn_reader(child.stdout.take());
    let stderr = spawn_reader(child.stderr.take());

    match tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait()).await {
        Ok(Ok(status)) => finished(false, status.code(), stdout, stderr).await,
        Ok(Err(err)) => {
            tracing::warn!(program = %spec.program, %err, "skills CLI wait failed");
            finished(false, None, stdout, stderr).await
        }
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            finished(true, None, stdout, stderr).await
        }
    }
}

fn spawn_child(spec: &CommandSpec, path: &str) -> std::io::Result<tokio::process::Child> {
    Command::new(&spec.program)
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .env("PATH", path)
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
}

async fn finished(
    timed_out: bool,
    exit_code: Option<i32>,
    stdout: ReaderHandle,
    stderr: ReaderHandle,
) -> CliOutcome {
    let out = stdout.await.unwrap_or_default();
    let err = stderr.await.unwrap_or_default();
    CliOutcome {
        started: true,
        timed_out,
        exit_code,
        stdout: String::from_utf8_lossy(&out).into_owned(),
        stderr: String::from_utf8_lossy(&err).into_owned(),
    }
}

type ReaderHandle = JoinHandle<Vec<u8>>;

fn spawn_reader<R>(pipe: Option<R>) -> ReaderHandle
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(read_capped(pipe))
}

async fn read_capped<R: AsyncRead + Unpin>(reader: Option<R>) -> Vec<u8> {
    let Some(mut reader) = reader else {
        return Vec::new();
    };
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let Ok(n) = reader.read(&mut chunk).await else {
            return buf;
        };
        if n == 0 || buf.len() >= MAX_CAPTURE_BYTES {
            return buf;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
}

/// Strips CSI (`ESC [ … final-byte`) and OSC (`ESC ] … BEL|ST`) escapes, plus
/// any other bare two-character escape — no ANSI crate is in the workspace
/// allowlist, so this is hand-rolled. `pub(crate)` so `probe_parse` (which
/// strips the CLI's TUI probe output the same way) can reuse it.
pub(crate) fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match chars.peek() {
            Some('[') => {
                chars.next();
                for next in chars.by_ref() {
                    if next.is_ascii_alphabetic() || next == '@' || next == '~' {
                        break;
                    }
                }
            }
            Some(']') => {
                chars.next();
                for next in chars.by_ref() {
                    if next == '\u{7}' {
                        break;
                    }
                }
            }
            Some(_) => {
                chars.next();
            }
            None => {}
        }
    }
    out
}

/// Last `n` chars of `s`, on a char boundary.
pub fn tail(s: &str, n: usize) -> String {
    let count = s.chars().count();
    if count <= n {
        return s.to_string();
    }
    s.chars().skip(count - n).collect()
}

/// Maps a raw [`CliOutcome`] to `Ok(ansi_stripped_stdout)` on a clean exit, or
/// the failure the wire contract's 502 body needs.
///
/// Success returns stdout alone so a JSON payload survives a chatty stderr;
/// failures keep both streams, since the reason for the failure is usually on
/// stderr and the tail is the only diagnostic the user gets.
pub(crate) fn map_outcome(outcome: CliOutcome) -> Result<String, SkillsCliError> {
    let stdout = strip_ansi(&outcome.stdout);
    if !outcome.started {
        return Err(cli_error(
            "skills CLI failed to start",
            &failure_text(&outcome),
            None,
        ));
    }
    if outcome.timed_out {
        return Err(cli_error(
            "skills CLI timed out",
            &failure_text(&outcome),
            None,
        ));
    }
    match outcome.exit_code {
        Some(0) => Ok(stdout),
        other => Err(cli_error(
            "skills CLI exited with a nonzero status",
            &failure_text(&outcome),
            other,
        )),
    }
}

fn failure_text(outcome: &CliOutcome) -> String {
    strip_ansi(&format!("{}{}", outcome.stdout, outcome.stderr))
}

fn cli_error(reason: &str, stripped_output: &str, exit_code: Option<i32>) -> SkillsCliError {
    SkillsCliError::Cli {
        reason: reason.to_string(),
        tail: tail(stripped_output, TAIL_CHARS),
        exit_code,
    }
}
