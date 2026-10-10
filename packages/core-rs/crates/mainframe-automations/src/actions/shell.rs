//! Process plumbing for `run_command`: shell resolution, capped stream capture,
//! and the login-shell spawn. Kept apart from the action's input/cwd/A1 logic
//! to hold both files under the 300-line rule.

use std::process::Stdio;

use mainframe_runtime::process::{ExecError, run_captured_limited};
use tokio::process::Command;

use super::ActionError;

/// Per-stream capture cap; exceeding it kills the child and fails the step.
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
    let mut command = Command::new(shell);
    command
        .arg("-lc")
        .arg(script)
        .current_dir(cwd)
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(Stdio::null());
    let output = run_captured_limited(command, None, MAX_OUTPUT_BYTES).await
        .map_err(|error| match error {
            ExecError::Spawn(error) => ActionError(format!("run_command failed to spawn {shell}: {error}")),
            ExecError::OutputLimit => ActionError(format!(
                "run_command output exceeded {MAX_OUTPUT_BYTES} bytes; write large data to a file instead"
            )),
            error => ActionError(format!("run_command I/O failed: {error}")),
        })?;
    let status = output.status;
    let exit_code = status.code().ok_or_else(|| {
        ActionError("run_command terminated by a signal before producing an exit code".to_string())
    })?;
    Ok((
        exit_code,
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    ))
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
