//! Running an upgrade command with its output streamed line by line.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use mainframe_runtime::ResolvedPath;
use mainframe_runtime::process::{ManagedProcess, Signal, spawn_line_pump};

use super::install::CommandSpec;

/// Brew may download and relink for minutes on a slow connection.
pub const UPDATE_TIMEOUT: Duration = Duration::from_secs(600);

/// Receives each stdout/stderr line, ANSI codes already stripped.
pub type OutputSink = Arc<dyn Fn(String) + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunOutcome {
    Exited(Option<i32>),
    SpawnFailed(String),
    TimedOut,
}

pub async fn run_update(command: CommandSpec, path: &ResolvedPath, sink: OutputSink) -> RunOutcome {
    let mut cmd = tokio::process::Command::new(&command.program);
    cmd.args(&command.args);
    path.apply(&mut cmd);
    cmd.env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0")
        // Brew and npm stay non-interactive with stdin closed; these quiet
        // the hints and prompts they would otherwise print.
        .env("NONINTERACTIVE", "1")
        .env("HOMEBREW_NO_ENV_HINTS", "1")
        .env("npm_config_fund", "false")
        .env("npm_config_audit", "false")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => return RunOutcome::SpawnFailed(error.to_string()),
    };
    let mut pumps = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        let sink = sink.clone();
        pumps.push(spawn_line_pump(stdout, move |line| sink(strip(&line))));
    }
    if let Some(stderr) = child.stderr.take() {
        let sink = sink.clone();
        pumps.push(spawn_line_pump(stderr, move |line| sink(strip(&line))));
    }
    let process = ManagedProcess::spawn(child, pumps);
    let exit = process.exit();
    match tokio::time::timeout(UPDATE_TIMEOUT, exit.wait()).await {
        Ok(code) => RunOutcome::Exited(code),
        Err(_) => {
            process.signal(Signal::Kill);
            exit.wait().await;
            RunOutcome::TimedOut
        }
    }
}

fn strip(line: &str) -> String {
    crate::skills_cli::run::strip_ansi(line)
        .trim_end_matches('\r')
        .to_string()
}

/// Whether the output reads like the install is owned by someone else or
/// needs administrator rights — npm's `EACCES`, brew's sudo prompt, a
/// root-owned prefix.
pub fn looks_like_permission_failure(output: &str) -> bool {
    const MARKERS: [&str; 6] = [
        "EACCES",
        "EPERM",
        "permission denied",
        "operation not permitted",
        "sudo",
        "not writable",
    ];
    let lower = output.to_lowercase();
    MARKERS
        .iter()
        .any(|marker| lower.contains(&marker.to_lowercase()))
}

#[cfg(test)]
#[path = "run_tests.rs"]
mod tests;
