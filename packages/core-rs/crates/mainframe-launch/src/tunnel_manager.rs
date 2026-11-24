//! Spawns `cloudflared` per label, scans its stdout/stderr for the
//! `*.trycloudflare.com` URL and the "Registered tunnel connection" line, then
//! waits for DNS propagation before resolving. Emits `tunnel:status` DaemonEvents
//! at each phase and exposes `verify()` (a cached `/health` probe). No `regex`
//! crate is allowlisted, so both patterns are hand-scanned, and no DNS resolver
//! crate is, so DNS propagation is checked through system resolution
//! (`tokio::net::lookup_host`) rather than a resolver pinned to 1.1.1.1.
//!
//! Each spawned child is owned by one watcher task, the only code that reaps it.
//! Stopping a tunnel sends SIGTERM through that watcher, escalates to SIGKILL
//! after `stop_grace`, and waits for the watcher to report the exit.
//!
//! `tunnels` holds the established tunnels by label; `verified_at` caches
//! each label's last `verify()` result for `verify_cache_ttl`.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, MutexGuard, TryLockError};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use mainframe_runtime::process::{PumpTasks, spawn_line_pump};
use mainframe_types::events::{DaemonEvent, TunnelState};
use serde::Deserialize;
use tokio::io::AsyncRead;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout};

use crate::process::{ChildRegistryPort, ManagedChildEntry, ManagedChildKind, NoopChildRegistry};
use crate::tunnel_error::TunnelStartError;
use mainframe_runtime::process::Signal;
use mainframe_types::BoxFuture;
use mainframe_types::time::now_ms;

/// Fire-and-forget DaemonEvent sink.
pub type BroadcastFn = Arc<dyn Fn(DaemonEvent) + Send + Sync>;

/// Delivers a signal to an owned pid and reports whether it was delivered.
/// A seam so tests can record the escalation.
pub(crate) type SignalFn = Arc<dyn Fn(u32, Signal) -> BoxFuture<'static, bool> + Send + Sync>;

const REGISTERED_MARKER: &str = "Registered tunnel connection";

/// Named/quick-tunnel start options.
#[derive(Debug, Clone, Default)]
pub struct TunnelStartOptions {
    pub token: Option<String>,
    pub url: Option<String>,
}

/// Registry + spawn-binary options.
#[derive(Default)]
pub struct TunnelManagerOptions {
    pub registry: Option<Arc<dyn ChildRegistryPort>>,
    /// Absolute cloudflared path to spawn; a bare name is spawned but never tracked.
    pub cloudflared_path: Option<String>,
}

/// Build the tunnel reap record for a spawned cloudflared pid, or `None` when the
/// path is a bare name (unsafe to reap) or the pid is missing. Extracted so the
/// record decision is unit-testable without spawning cloudflared.
fn tunnel_record_entry(
    cloudflared_path: &str,
    pid: Option<u32>,
    label: &str,
) -> Option<ManagedChildEntry> {
    let pid = pid?;
    if !Path::new(cloudflared_path).is_absolute() {
        return None;
    }
    Some(ManagedChildEntry {
        pid: i64::from(pid),
        kind: ManagedChildKind::Tunnel,
        command: cloudflared_path.to_string(),
        args: vec![],
        cwd: None,
        group: false,
        label: label.to_string(),
        spawned_at: now_ms(),
    })
}

/// Tunable timings + binary path. Tests shrink
/// the timings and point `cloudflared_bin` at a stand-in script.
#[derive(Debug, Clone)]
pub struct TunnelConfig {
    pub cloudflared_bin: String,
    pub start_timeout: Duration,
    pub dns_poll: Duration,
    pub dns_timeout: Duration,
    pub verify_timeout: Duration,
    pub verify_cache_ttl: Duration,
    /// How long a stopping cloudflared gets after SIGTERM before SIGKILL, and
    /// again after SIGKILL before the stop gives up waiting.
    pub stop_grace: Duration,
}

impl Default for TunnelConfig {
    fn default() -> Self {
        Self {
            cloudflared_bin: "cloudflared".to_string(),
            start_timeout: Duration::from_millis(45_000),
            dns_poll: Duration::from_millis(1_000),
            // Cloudflare's first-time DNS propagation routinely takes 20–30s.
            dns_timeout: Duration::from_millis(45_000),
            verify_timeout: Duration::from_millis(5_000),
            verify_cache_ttl: Duration::from_millis(30_000),
            stop_grace: Duration::from_millis(2_000),
        }
    }
}

struct ManagedTunnel {
    process: TunnelProcess,
    url: String,
    ready: bool,
}

struct VerifyResult {
    reachable: bool,
    checked_at: Instant,
}

#[derive(Deserialize)]
struct HealthBody {
    status: Option<String>,
}

/// Build the configured (unspawned) `cloudflared` command. Extracted so the
/// spawn-env contract — notably the boot-resolved login-shell `PATH` — is
/// unit-testable without launching a real tunnel.
fn build_cloudflared_command(bin: &str, args: &[String], resolved_path: Option<&str>) -> Command {
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(path) = resolved_path {
        cmd.env("PATH", path);
    }
    cmd
}

pub struct TunnelManager {
    tunnels: Arc<DashMap<String, ManagedTunnel>>,
    /// Every spawned cloudflared not yet reaped — still starting, running, or
    /// being stopped — so `stop_all` can wait for each one. A child's watcher
    /// removes its entry once it has reaped the child.
    live: Arc<StdMutex<HashMap<u64, TunnelProcess>>>,
    next_id: AtomicU64,
    spawn_gate: tokio::sync::Mutex<bool>,
    verified_at: Arc<DashMap<String, VerifyResult>>,
    broadcast: BroadcastFn,
    config: TunnelConfig,
    client: Result<reqwest::Client, reqwest::Error>,
    /// Pidfile registry so a crashed daemon's next startup sweep can reap tunnels
    /// it leaked. Defaults to `NoopChildRegistry`.
    registry: Arc<dyn ChildRegistryPort>,
    /// Boot-resolved login-shell `PATH`, applied to the spawned `cloudflared` so
    /// packaged builds find it outside the bare launchd `PATH`. `None` = inherit the daemon `PATH`.
    resolved_path: Option<mainframe_runtime::ResolvedPath>,
    signal: SignalFn,
}

fn extract_hostname(url: &str) -> String {
    let after = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);
    after.split(['/', ':']).next().unwrap_or(after).to_string()
}

/// Drain the child's stdout and stderr for its whole life, forwarding each
/// line to the returned receiver while it is held. Closing the pipes instead
/// would kill cloudflared (Go) with SIGPIPE at its next log write. Lines are
/// decoded lossily, so a non-UTF-8 byte cannot end the drain.
fn pump_output_lines(child: &mut Child) -> (PumpTasks, mpsc::UnboundedReceiver<String>) {
    let (line_tx, lines) = mpsc::unbounded_channel();
    let mut tasks = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        tasks.push(forward_lines(stdout, line_tx.clone()));
    }
    if let Some(stderr) = child.stderr.take() {
        tasks.push(forward_lines(stderr, line_tx));
    }
    (PumpTasks::new(tasks), lines)
}

fn forward_lines<R>(stream: R, line_tx: mpsc::UnboundedSender<String>) -> JoinHandle<()>
where
    R: AsyncRead + Unpin + Send + 'static,
{
    spawn_line_pump(stream, move |line| {
        let _ = line_tx.send(line); /* expected: Err once the start stopped reading */
    })
}

#[cfg(test)]
impl TunnelProcess {
    /// A process whose watcher has already reported its exit.
    fn exited_for_test() -> Self {
        let (signals, _) = mpsc::unbounded_channel();
        let (_, exit) = watch::channel(Some(TunnelExit { code: Some(0) }));
        Self {
            id: u64::MAX,
            label: String::new(),
            pid: None,
            signals,
            exit,
            stopping: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[cfg(test)]
impl TunnelManager {
    pub(crate) fn set_signal(&mut self, signal: SignalFn) {
        self.signal = signal;
    }

    /// Children spawned and not yet reaped by their watcher.
    pub(crate) fn live_count(&self) -> usize {
        self.lock_live().len()
    }

    pub(crate) fn pid_of(&self, label: &str) -> Option<u32> {
        self.tunnels.get(label).and_then(|t| t.process.pid)
    }
}

#[cfg(test)]
#[path = "tunnel_manager_tests.rs"]
mod tests;

use process::deliver;
pub(crate) use process::kill_signal;
use process::{StartGuard, TunnelExit, TunnelProcess};
mod construction;
mod events;
mod health;
mod process;
mod start;
mod stop;
mod watcher;
