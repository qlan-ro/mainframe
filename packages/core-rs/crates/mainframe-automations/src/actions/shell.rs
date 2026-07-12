//! Process plumbing for `run_command` (T6.3): shell resolution, capped
//! stream capture, and the login-shell spawn. Kept apart from the action's
//! input/cwd/A1 logic to hold both files under the 300-line rule.

use std::process::Stdio;

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

use super::ActionError;

/// Node's execFile maxBuffer (actions/run-command.ts MAX_OUTPUT_BYTES).
pub(crate) const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;

pub(crate) async fn resolve_shell() -> String {
    match tokio::fs::try_exists("/bin/zsh").await {
        Ok(true) => "/bin/zsh".to_string(),
        _ => "/bin/sh".to_string(),
    }
}

pub(crate) async fn spawn_script(
    shell: &str,
    script: &str,
    cwd: &str,
    env: &[(String, String)],
) -> Result<(i32, String, String), ActionError> {
    let mut child = Command::new(shell)
        .arg("-lc")
        .arg(script)
        .current_dir(cwd)
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| ActionError(format!("run_command failed to spawn {shell}: {err}")))?;

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let (out, err) = tokio::join!(read_capped(stdout_pipe), read_capped(stderr_pipe));
    let (stdout, out_exceeded) = out.map_err(io_error)?;
    let (stderr, err_exceeded) = err.map_err(io_error)?;

    if out_exceeded || err_exceeded {
        // Node parity: execFile kills the child when maxBuffer is exceeded.
        let _ = child.start_kill();
        let _ = child.wait().await;
        return Err(ActionError(format!(
            "run_command output exceeded {MAX_OUTPUT_BYTES} bytes; write large data to a file instead"
        )));
    }

    let status = child.wait().await.map_err(io_error)?;
    let exit_code = status.code().ok_or_else(|| {
        ActionError("run_command terminated by a signal before producing an exit code".to_string())
    })?;
    Ok((
        exit_code,
        String::from_utf8_lossy(&stdout).into_owned(),
        String::from_utf8_lossy(&stderr).into_owned(),
    ))
}

async fn read_capped<R: AsyncRead + Unpin>(reader: Option<R>) -> std::io::Result<(Vec<u8>, bool)> {
    let Some(mut reader) = reader else {
        return Ok((Vec::new(), false));
    };
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let n = reader.read(&mut chunk).await?;
        if n == 0 {
            return Ok((buf, false));
        }
        if buf.len() + n > MAX_OUTPUT_BYTES {
            return Ok((buf, true));
        }
        buf.extend_from_slice(&chunk[..n]);
    }
}

/// Last `n` chars of `s`, respecting char boundaries.
pub(crate) fn tail_chars(s: &str, n: usize) -> &str {
    let count = s.chars().count();
    if count <= n {
        return s;
    }
    s.char_indices()
        .nth(count - n)
        .map(|(idx, _)| &s[idx..])
        .unwrap_or(s)
}

fn io_error(err: std::io::Error) -> ActionError {
    ActionError(format!("run_command I/O failed: {err}"))
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T6.3), not a TS port
// confidence: high
// todos: 0
// notes: split out of run_command.rs (300-line rule); semantics unchanged.
