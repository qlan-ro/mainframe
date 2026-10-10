mod capture;
mod retained;
pub use retained::{RetainedOutput, run_captured_prefix};
mod managed;
pub use managed::{ExitLatch, ManagedProcess, TailBuffer};
pub mod inspect;
mod pumps;
mod signal;
pub use pumps::{PumpTasks, finish_pumps, spawn_chunk_pump, spawn_line_pump, spawn_stdin_writer};

pub use capture::{ExecError, run_captured, run_captured_limited};
pub use signal::{Signal, Target, Terminated, is_alive, signal, terminate, terminate_with};

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
mod tests;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecCode {
    Number(i64),
    Text(String),
}

#[cfg(test)]
mod managed_tests;
