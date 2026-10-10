//! Spawns a user launch process per config name, streams its stdout/stderr as
//! `launch.output` events, waits for its TCP port before declaring `running`,
//! and tears it down (process-group SIGTERM → SIGKILL) on stop. Status/output
//! survive the process map entry via `LaunchProcessState`. When a config is
//! `preview` with a port and a `TunnelManager` is present, a tunnel is started
//! and its URL / failure emitted.
//!
//! State: `processes` = `Arc<DashMap<String, ManagedProcess>>` (name →
//! child handle + status). Env is threaded explicitly (no `std::env::set_var`):
//! `clean_env` reads a snapshot map, so the MAINFRAME_ORIG_PATH clean-env
//! contract is unit-testable without mutating global state.

use mainframe_runtime::process::TailBuffer;
use mainframe_types::sync::LockExt;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use mainframe_types::events::{DaemonEvent, LaunchStream};
use mainframe_types::launch::{LaunchConfiguration, LaunchProcessStatus};
use tokio::process::Command;
use tokio::sync::watch;
use tokio::time::sleep;

use crate::launch_process_state::{LaunchOutputEntry, LaunchProcessState};
use crate::process::{
    BoxFuture, ChildRegistryPort, ManagedChildEntry, ManagedChildKind, default_process_command,
    now_ms,
};
use crate::tunnel_manager::{BroadcastFn, TunnelManager};

const MAX_STDERR_LINES: usize = 20;

/// Reads a pid's live command line (`ps -o command=`); injectable for tests.
pub type ReadCommandFn = Arc<dyn Fn(i64) -> BoxFuture<'static, Option<String>> + Send + Sync>;

fn default_read_command() -> ReadCommandFn {
    Arc::new(|pid| Box::pin(default_process_command(pid)))
}

/// Lexically resolve a relative executable against an absolute project dir,
/// normalizing `.`/`..` like `path.resolve(projectPath, exe)`, so the
/// recorded reap command matches what the sweep reads back.
fn lexical_resolve(base: &str, rel: &str) -> String {
    let mut stack: Vec<&str> = Vec::new();
    for comp in base.split('/').chain(rel.split('/')) {
        match comp {
            "" | "." => {}
            ".." => {
                stack.pop();
            }
            other => stack.push(other),
        }
    }
    format!("/{}", stack.join("/"))
}

/// Tunable timings: the port poll interval, the port-readiness timeout, and the
/// 5s SIGTERM→SIGKILL grace.
#[derive(Debug, Clone)]
pub struct LaunchTimings {
    pub port_poll: Duration,
    pub port_timeout: Duration,
    pub stop_grace: Duration,
}

impl Default for LaunchTimings {
    fn default() -> Self {
        Self {
            port_poll: Duration::from_millis(1_000),
            port_timeout: Duration::from_millis(60_000),
            stop_grace: Duration::from_millis(5_000),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum LaunchError {
    #[error("Daemon is shutting down")]
    ShuttingDown,
    #[error("failed to spawn launch process '{name}': {source}")]
    Spawn {
        name: String,
        #[source]
        source: std::io::Error,
    },
}

/// Allowlisted env var names passed to launched processes. Everything else from
/// the daemon (Electron, pnpm, internal Node vars) is dropped; users add
/// arbitrary vars via the launch config `env` block.
static ENV_ALLOWLIST_EXACT: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    [
        // OS / user identity
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "SHELL",
        "TERM",
        "TERM_PROGRAM",
        "TMPDIR",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_CACHE_HOME",
        "XDG_RUNTIME_DIR",
        "DISPLAY",
        "SSH_AUTH_SOCK",
        "COLORTERM",
        "EDITOR",
        "VISUAL",
        // Developer toolchains
        "JAVA_HOME",
        "ANDROID_HOME",
        "ANDROID_SDK_ROOT",
        "GOPATH",
        "GOROOT",
        "CARGO_HOME",
        "RUSTUP_HOME",
        "PYENV_ROOT",
        "NVM_DIR",
        "VOLTA_HOME",
        "BUN_INSTALL",
        "DENO_DIR",
        "DOTNET_ROOT",
        "GRADLE_HOME",
        "MAVEN_HOME",
        "M2_HOME",
    ]
    .into_iter()
    .collect()
});

const ENV_ALLOWLIST_PREFIXES: [&str; 2] = ["LANG", "LC_"];

struct ManagedProcess {
    status: Arc<Mutex<LaunchProcessStatus>>,
    pid: Option<u32>,
    exit_rx: watch::Receiver<bool>,
}

struct Inner {
    project_id: String,
    project_path: String,
    on_event: BroadcastFn,
    tunnel_manager: Option<Arc<TunnelManager>>,
    processes: DashMap<String, ManagedProcess>,
    state: LaunchProcessState,
    timings: LaunchTimings,
    /// Pidfile registry so a crashed daemon's next startup sweep can reap this
    /// manager's detached launch groups. `None` = not tracked.
    child_registry: Option<Arc<dyn ChildRegistryPort>>,
    /// Reads a pid's live command line for the sweep identity guard; injectable.
    read_process_command: ReadCommandFn,
    /// Boot-resolved login-shell `PATH` forwarded to launch children
    /// (`MAINFRAME_ORIG_PATH` still overrides it in `clean_env`). `None`
    /// inherits the daemon `PATH`.
    resolved_path: Option<mainframe_runtime::ResolvedPath>,
}

pub struct LaunchManager {
    inner: Arc<Inner>,
    spawn_gate: Arc<tokio::sync::Mutex<bool>>,
}

#[cfg(test)]
mod tests;

mod construction;
mod env;
mod lifecycle;
mod process;
mod start;
mod state;
pub use env::clean_env;
use env::compose_launch_env;
use process::{kill_process, pump_output, wait_for_exit_task, wait_for_port, wait_until_exited};
