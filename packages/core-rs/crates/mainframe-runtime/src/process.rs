//! The daemon's one process module: signal delivery, TERM→grace→KILL
//! escalation, run-with-capture, stdin/stdout pumps, and a child owner that
//! kills and reaps on drop. Consumers keep their own supervision policy (what
//! to broadcast, which registry to update) and call in here for the mechanics.

mod capture;
pub mod inspect;
mod managed;
mod pumps;
mod retained;
mod signal;

pub use capture::{ExecCode, ExecError, run_captured, run_captured_limited};
pub use managed::{ExitLatch, ManagedProcess, TailBuffer};
pub use pumps::{PumpTasks, finish_pumps, spawn_chunk_pump, spawn_line_pump, spawn_stdin_writer};
pub use retained::{RetainedOutput, run_captured_prefix};
pub use signal::{Signal, Target, Terminated, is_alive, signal, terminate, terminate_with};

/// A CLI child the way every adapter spawns one: the resolved `PATH`, colour
/// output off, all three stdio pipes, and `kill_on_drop` as the last resort.
pub fn cli_command(exe: &str, path: &crate::ResolvedPath) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(exe);
    path.apply(&mut command);
    command
        .env("FORCE_COLOR", "0")
        .env("NO_COLOR", "1")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    command
}

#[cfg(test)]
mod managed_tests;
#[cfg(test)]
mod tests;
