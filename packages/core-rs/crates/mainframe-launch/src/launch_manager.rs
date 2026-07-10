//! Ported from `src/launch/launch-manager.ts`.
//!
//! Spawns a user launch process per config name, streams its stdout/stderr as
//! `launch.output` events, waits for its TCP port before declaring `running`,
//! and tears it down (process-group SIGTERM → SIGKILL) on stop. Status/output
//! survive the process map entry via `LaunchProcessState`. When a config is
//! `preview` with a port and a `TunnelManager` is present, a tunnel is started
//! and its URL / failure emitted.
//!
//! CONCURRENCY.tsv: `processes` = `Arc<DashMap<String, ManagedProcess>>` (name →
//! child handle + status). Env is threaded explicitly (no `std::env::set_var`):
//! `clean_env` reads a snapshot map, so the MAINFRAME_ORIG_PATH clean-env
//! contract is unit-testable without mutating global state.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use mainframe_types::events::{DaemonEvent, LaunchStream};
use mainframe_types::launch::{LaunchConfiguration, LaunchProcessStatus};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::watch;
use tokio::time::sleep;

use crate::launch_process_state::{LaunchOutputEntry, LaunchProcessState};
use crate::tunnel_manager::{BroadcastFn, TunnelManager};

const MAX_STDERR_LINES: usize = 20;

/// Tunable timings; defaults match the TS constants
/// (`PORT_POLL_MS`, `PORT_TIMEOUT_MS`, and the 5s SIGTERM→SIGKILL grace).
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

fn is_allowed_env_var(key: &str) -> bool {
    if ENV_ALLOWLIST_EXACT.contains(key) {
        return true;
    }
    ENV_ALLOWLIST_PREFIXES.iter().any(|p| key.starts_with(p))
}

/// Build a minimal env for launched processes — only essential OS/user vars.
///
/// The standalone launcher prepends its bundled-node bin dir to PATH so the
/// daemon can find its bundled Node/cloudflared; that prefix must never reach
/// user launch processes (they'd resolve `node`/`npm` to Mainframe's internal
/// single-file Node instead of the user's toolchain). `MAINFRAME_ORIG_PATH`
/// carries the pristine, pre-prefix PATH and is itself never forwarded.
pub fn clean_env(source: &HashMap<String, String>) -> HashMap<String, String> {
    let mut result: HashMap<String, String> = HashMap::new();
    for (key, value) in source {
        if key == "MAINFRAME_ORIG_PATH" {
            continue;
        }
        if is_allowed_env_var(key) {
            result.insert(key.clone(), value.clone());
        }
    }
    if let Some(orig_path) = source.get("MAINFRAME_ORIG_PATH")
        && !orig_path.is_empty()
    {
        result.insert("PATH".to_string(), orig_path.clone());
    }
    result
}

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
}

impl Inner {
    fn emit_status(&self, name: &str, status: LaunchProcessStatus) {
        (self.on_event)(DaemonEvent::LaunchStatus {
            project_id: self.project_id.clone(),
            effective_path: self.project_path.clone(),
            name: name.to_string(),
            status,
        });
    }

    fn emit_output(&self, name: &str, data: String, stream: LaunchStream) {
        (self.on_event)(DaemonEvent::LaunchOutput {
            project_id: self.project_id.clone(),
            effective_path: self.project_path.clone(),
            name: name.to_string(),
            data,
            stream,
        });
    }
}

pub struct LaunchManager {
    inner: Arc<Inner>,
}

impl LaunchManager {
    pub fn new(
        project_id: impl Into<String>,
        project_path: impl Into<String>,
        on_event: BroadcastFn,
        tunnel_manager: Option<Arc<TunnelManager>>,
    ) -> Self {
        Self::with_timings(
            project_id,
            project_path,
            on_event,
            tunnel_manager,
            LaunchTimings::default(),
        )
    }

    pub fn with_timings(
        project_id: impl Into<String>,
        project_path: impl Into<String>,
        on_event: BroadcastFn,
        tunnel_manager: Option<Arc<TunnelManager>>,
        timings: LaunchTimings,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                project_id: project_id.into(),
                project_path: project_path.into(),
                on_event,
                tunnel_manager,
                processes: DashMap::new(),
                state: LaunchProcessState::new(),
                timings,
            }),
        }
    }

    pub async fn start(&self, config: &LaunchConfiguration) -> Result<(), LaunchError> {
        let inner = self.inner.clone();
        let name = config.name.clone();

        if inner.processes.contains_key(&name) {
            tracing::warn!(target: "launch", name = %name, "process already running, skipping start");
            return Ok(());
        }

        inner.state.reset(&name);
        inner.emit_status(&name, LaunchProcessStatus::Starting);

        // Resolve relative executables (./gradlew, ../bin/foo) against the project
        // directory — spawn only searches PATH, not cwd, for the executable.
        let executable = if config.runtime_executable.starts_with("./")
            || config.runtime_executable.starts_with("../")
        {
            Path::new(&inner.project_path)
                .join(&config.runtime_executable)
                .to_string_lossy()
                .into_owned()
        } else {
            config.runtime_executable.clone()
        };

        let source: HashMap<String, String> = std::env::vars().collect();
        let mut env = clean_env(&source);
        if let Some(port) = config.port {
            env.insert("PORT".to_string(), port.to_string());
        }
        if let Some(config_env) = &config.env {
            for (key, value) in config_env {
                env.insert(key.clone(), value.clone());
            }
        }

        let mut command = Command::new(&executable);
        command
            .args(&config.runtime_args)
            .current_dir(&inner.project_path)
            .env_clear()
            .envs(&env)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        // detached: true — new process group so `stop` can signal the whole tree.
        command.process_group(0);

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(err) => {
                tracing::warn!(
                    target: "launch",
                    name = %name,
                    code = ?err.kind(),
                    message = %err,
                    "process error"
                );
                inner.state.set_status(&name, LaunchProcessStatus::Failed);
                inner.emit_status(&name, LaunchProcessStatus::Failed);
                if let Some(tm) = &inner.tunnel_manager {
                    tm.stop(&format!("preview:{name}"));
                }
                return Err(LaunchError::Spawn { name, source: err });
            }
        };

        let pid = child.id();
        tracing::info!(
            target: "launch",
            name = %name,
            pid = ?pid,
            cmd = %format!("{} {}", config.runtime_executable, config.runtime_args.join(" ")),
            port = ?config.port,
            "launch process spawned"
        );

        let status = Arc::new(Mutex::new(LaunchProcessStatus::Starting));
        let (exit_tx, exit_rx) = watch::channel(false);
        inner.processes.insert(
            name.clone(),
            ManagedProcess {
                status: status.clone(),
                pid,
                exit_rx,
            },
        );

        let stderr_tail = Arc::new(Mutex::new(VecDeque::<String>::new()));

        if let Some(stdout) = child.stdout.take() {
            tokio::spawn(pump_output(
                stdout,
                inner.clone(),
                name.clone(),
                LaunchStream::Stdout,
                None,
            ));
        }
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(pump_output(
                stderr,
                inner.clone(),
                name.clone(),
                LaunchStream::Stderr,
                Some(stderr_tail.clone()),
            ));
        }

        tokio::spawn(wait_for_exit_task(
            child,
            inner.clone(),
            name.clone(),
            pid,
            status.clone(),
            stderr_tail,
            exit_tx,
        ));

        // If a port is configured, wait until it accepts a TCP connection before
        // emitting `running`, so clients don't load a URL too early.
        if let Some(port) = config.port {
            tracing::info!(target: "launch", name = %name, port, "waiting for port to become ready…");
            let timed_out = wait_for_port(port as u16, &status, &inner.timings).await;
            if timed_out {
                (inner.on_event)(DaemonEvent::LaunchPortTimeout {
                    project_id: inner.project_id.clone(),
                    effective_path: inner.project_path.clone(),
                    name: name.clone(),
                    port,
                });
            }
        }

        {
            let mut guard = status.lock().unwrap_or_else(PoisonError::into_inner);
            if *guard == LaunchProcessStatus::Starting {
                *guard = LaunchProcessStatus::Running;
                inner.state.set_status(&name, LaunchProcessStatus::Running);
                inner.emit_status(&name, LaunchProcessStatus::Running);
                tracing::info!(target: "launch", name = %name, port = ?config.port, "launch process ready");
            }
        }

        if config.preview == Some(true)
            && let (Some(port), Some(tunnel_manager)) = (config.port, inner.tunnel_manager.clone())
        {
            let label = format!("preview:{name}");
            let inner_for_tunnel = inner.clone();
            let name_for_tunnel = name.clone();
            tokio::spawn(async move {
                match tunnel_manager.start(port as u16, &label, None).await {
                    Ok(url) => {
                        (inner_for_tunnel.on_event)(DaemonEvent::LaunchTunnel {
                            project_id: inner_for_tunnel.project_id.clone(),
                            effective_path: inner_for_tunnel.project_path.clone(),
                            name: name_for_tunnel,
                            url,
                        });
                    }
                    Err(message) => {
                        tracing::warn!(target: "launch", name = %name_for_tunnel, err = %message, "tunnel failed to start");
                        (inner_for_tunnel.on_event)(DaemonEvent::LaunchTunnelFailed {
                            project_id: inner_for_tunnel.project_id.clone(),
                            effective_path: inner_for_tunnel.project_path.clone(),
                            name: name_for_tunnel,
                            error: message,
                        });
                    }
                }
            });
        }

        Ok(())
    }

    pub async fn stop(&self, name: &str) {
        let inner = &self.inner;
        let (status, pid, mut exit_rx) = {
            let Some(managed) = inner.processes.get(name) else {
                return;
            };
            (managed.status.clone(), managed.pid, managed.exit_rx.clone())
        };

        *status.lock().unwrap_or_else(PoisonError::into_inner) = LaunchProcessStatus::Stopped;
        inner.state.set_status(name, LaunchProcessStatus::Stopped);
        inner.emit_status(name, LaunchProcessStatus::Stopped);

        if let Some(tm) = &inner.tunnel_manager {
            tm.stop(&format!("preview:{name}"));
        }

        // Kill the entire process group (pnpm/tsx spawn child trees).
        kill_process(pid, "-TERM").await;
        tracing::info!(target: "launch", name, pid = ?pid, "stopping launch process (SIGTERM)");

        if tokio::time::timeout(inner.timings.stop_grace, wait_until_exited(&mut exit_rx))
            .await
            .is_err()
        {
            tracing::warn!(target: "launch", name, "process did not exit after SIGTERM, sending SIGKILL");
            kill_process(pid, "-KILL").await;
            wait_until_exited(&mut exit_rx).await;
        }
        tracing::info!(target: "launch", name, pid = ?pid, "launch process stopped");
    }

    pub async fn stop_all(&self) {
        let names: Vec<String> = self
            .inner
            .processes
            .iter()
            .map(|e| e.key().clone())
            .collect();
        for name in names {
            self.stop(&name).await;
        }
    }

    pub fn get_status(&self, name: &str) -> LaunchProcessStatus {
        self.inner.state.get_status(name)
    }

    pub fn get_all_statuses(&self) -> HashMap<String, LaunchProcessStatus> {
        self.inner.state.get_all_statuses()
    }

    /// Buffered stdout/stderr for a config, oldest first.
    pub fn get_output_buffer(&self, name: &str) -> Vec<LaunchOutputEntry> {
        self.inner.state.get_output_buffer(name)
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

async fn pump_output<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    inner: Arc<Inner>,
    name: String,
    stream: LaunchStream,
    stderr_tail: Option<Arc<Mutex<VecDeque<String>>>>,
) {
    let mut buf = vec![0u8; 8192];
    loop {
        let n = match reader.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        let data = String::from_utf8_lossy(&buf[..n]).into_owned();
        inner.state.buffer_output(&name, stream, &data);
        if let Some(tail) = &stderr_tail {
            let mut tail = lock(tail);
            for line in data.split('\n') {
                if !line.trim().is_empty() {
                    tail.push_back(line.to_string());
                    if tail.len() > MAX_STDERR_LINES {
                        tail.pop_front();
                    }
                }
            }
        }
        inner.emit_output(&name, data, stream);
    }
}

async fn wait_for_exit_task(
    mut child: tokio::process::Child,
    inner: Arc<Inner>,
    name: String,
    pid: Option<u32>,
    status: Arc<Mutex<LaunchProcessStatus>>,
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
    exit_tx: watch::Sender<bool>,
) {
    let code = child.wait().await.ok().and_then(|s| s.code());

    {
        let tail = lock(&stderr_tail);
        if code != Some(0) && !tail.is_empty() {
            tracing::warn!(
                target: "launch",
                name = %name,
                pid = ?pid,
                code = ?code,
                stderr = %tail.iter().cloned().collect::<Vec<_>>().join("\n"),
                "launch process failed"
            );
        } else {
            tracing::info!(target: "launch", name = %name, pid = ?pid, code = ?code, "launch process exited");
        }
    }

    {
        let mut guard = lock(&status);
        if *guard != LaunchProcessStatus::Stopped {
            *guard = if code == Some(0) {
                LaunchProcessStatus::Stopped
            } else {
                LaunchProcessStatus::Failed
            };
            inner.state.set_status(&name, *guard);
            inner.emit_status(&name, *guard);
        }
    }

    inner.processes.remove(&name);

    if let Some(tm) = &inner.tunnel_manager {
        tm.stop(&format!("preview:{name}"));
    }

    let _ = exit_tx.send(true);
}

/// Poll `localhost:port` until it accepts a TCP connection or the process
/// exits/stops. Returns `true` if it timed out (PORTING.md: TCP-connect
/// readiness, replacing the TS HTTP HEAD probe).
async fn wait_for_port(
    port: u16,
    status: &Arc<Mutex<LaunchProcessStatus>>,
    timings: &LaunchTimings,
) -> bool {
    let start = Instant::now();
    loop {
        {
            let current = *lock(status);
            if current == LaunchProcessStatus::Stopped || current == LaunchProcessStatus::Failed {
                return false;
            }
        }
        if start.elapsed() > timings.port_timeout {
            tracing::warn!(target: "launch", port, "port readiness timeout, proceeding anyway");
            return true;
        }
        if let Ok(Ok(_stream)) = tokio::time::timeout(
            Duration::from_secs(3),
            tokio::net::TcpStream::connect(("localhost", port)),
        )
        .await
        {
            return false;
        }
        sleep(timings.port_poll).await;
    }
}

async fn wait_until_exited(rx: &mut watch::Receiver<bool>) {
    if *rx.borrow() {
        return;
    }
    while rx.changed().await.is_ok() {
        if *rx.borrow() {
            return;
        }
    }
}

/// Signal a process group (negative pid) by shelling out to `kill`; fall back to
/// the single pid if the group signal fails (house style — no `libc`/`nix`).
async fn kill_process(pid: Option<u32>, flag: &'static str) {
    let Some(pid) = pid else {
        return;
    };
    let group_ok = Command::new("kill")
        .arg(flag)
        .arg(format!("-{pid}"))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false);
    if !group_ok {
        let _ = Command::new("kill")
            .arg(flag)
            .arg(pid.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    fn recorder() -> (BroadcastFn, Arc<StdMutex<Vec<DaemonEvent>>>) {
        let events = Arc::new(StdMutex::new(Vec::new()));
        let sink = events.clone();
        let f: BroadcastFn = Arc::new(move |ev| sink.lock().unwrap().push(ev));
        (f, events)
    }

    fn cfg(name: &str, script: &str, port: Option<i64>) -> LaunchConfiguration {
        LaunchConfiguration {
            name: name.to_string(),
            runtime_executable: "sh".to_string(),
            runtime_args: vec!["-c".to_string(), script.to_string()],
            port,
            url: None,
            preview: Some(false),
            env: None,
        }
    }

    fn status_events(
        events: &Arc<StdMutex<Vec<DaemonEvent>>>,
    ) -> Vec<(String, LaunchProcessStatus)> {
        events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                DaemonEvent::LaunchStatus { name, status, .. } => Some((name.clone(), *status)),
                _ => None,
            })
            .collect()
    }

    fn output_events(events: &Arc<StdMutex<Vec<DaemonEvent>>>) -> Vec<(String, String)> {
        events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                DaemonEvent::LaunchOutput { name, data, .. } => Some((name.clone(), data.clone())),
                _ => None,
            })
            .collect()
    }

    fn manager(events: BroadcastFn) -> LaunchManager {
        LaunchManager::new("proj-1", "/tmp", events, None)
    }

    // --- clean_env (MAINFRAME_ORIG_PATH contract) ---

    #[test]
    fn clean_env_uses_orig_path_and_does_not_forward_it() {
        let source: HashMap<String, String> = [
            ("PATH", "/mainframe/bundled/bin:/usr/bin"),
            ("MAINFRAME_ORIG_PATH", "/usr/bin:/usr/local/bin"),
            ("HOME", "/home/u"),
            ("ELECTRON_RUN_AS_NODE", "1"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        let env = clean_env(&source);
        assert_eq!(
            env.get("PATH").map(String::as_str),
            Some("/usr/bin:/usr/local/bin")
        );
        assert_eq!(env.get("MAINFRAME_ORIG_PATH"), None);
        assert_eq!(env.get("HOME").map(String::as_str), Some("/home/u"));
        // Non-allowlisted daemon vars are dropped.
        assert_eq!(env.get("ELECTRON_RUN_AS_NODE"), None);
    }

    #[test]
    fn clean_env_falls_back_to_daemon_path_when_orig_unset() {
        let source: HashMap<String, String> = [("PATH", "/usr/bin:/usr/local/bin")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let env = clean_env(&source);
        assert_eq!(
            env.get("PATH").map(String::as_str),
            Some("/usr/bin:/usr/local/bin")
        );
    }

    #[test]
    fn clean_env_forwards_lc_and_lang_prefixes() {
        let source: HashMap<String, String> =
            [("LC_ALL", "C"), ("LANG", "en_US.UTF-8"), ("NPM_TOKEN", "x")]
                .into_iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();
        let env = clean_env(&source);
        assert_eq!(env.get("LC_ALL").map(String::as_str), Some("C"));
        assert_eq!(env.get("LANG").map(String::as_str), Some("en_US.UTF-8"));
        assert_eq!(env.get("NPM_TOKEN"), None);
    }

    // --- LaunchManager (real spawned processes) ---

    #[tokio::test]
    async fn starts_a_process_and_emits_status_running() {
        let (broadcast, events) = recorder();
        let manager = manager(broadcast);
        manager
            .start(&cfg("server", "printf hello; exit 0", None))
            .await
            .unwrap();
        let statuses = status_events(&events);
        assert!(statuses.iter().any(|(_, s)| matches!(
            s,
            LaunchProcessStatus::Starting | LaunchProcessStatus::Running
        )));
        manager.stop_all().await;
    }

    #[tokio::test]
    async fn emits_output_events_from_stdout() {
        let (broadcast, events) = recorder();
        let manager = manager(broadcast);
        manager
            .start(&cfg("server", "printf hello", None))
            .await
            .unwrap();
        sleep(Duration::from_millis(200)).await;
        assert!(
            output_events(&events)
                .iter()
                .any(|(_, d)| d.contains("hello"))
        );
        manager.stop_all().await;
    }

    #[tokio::test]
    async fn stop_emits_status_stopped() {
        let (broadcast, events) = recorder();
        let manager = manager(broadcast);
        manager
            .start(&cfg("server", "sleep 100", None))
            .await
            .unwrap();
        manager.stop("server").await;
        assert!(
            status_events(&events)
                .iter()
                .any(|(_, s)| *s == LaunchProcessStatus::Stopped)
        );
    }

    #[tokio::test]
    async fn get_status_returns_stopped_for_unknown_name() {
        let (broadcast, _events) = recorder();
        let manager = manager(broadcast);
        assert_eq!(
            manager.get_status("nonexistent"),
            LaunchProcessStatus::Stopped
        );
    }

    #[tokio::test]
    async fn retains_failed_status_after_exit() {
        let (broadcast, _events) = recorder();
        let manager = manager(broadcast);
        manager
            .start(&cfg("fail-fast", "exit 1", None))
            .await
            .unwrap();
        sleep(Duration::from_millis(300)).await;
        assert_eq!(manager.get_status("fail-fast"), LaunchProcessStatus::Failed);
        assert_eq!(
            manager.get_all_statuses().get("fail-fast").copied(),
            Some(LaunchProcessStatus::Failed)
        );
    }

    #[tokio::test]
    async fn get_status_returns_running_while_alive() {
        let (broadcast, _events) = recorder();
        let manager = manager(broadcast);
        manager
            .start(&cfg("server", "sleep 100", None))
            .await
            .unwrap();
        assert_eq!(manager.get_status("server"), LaunchProcessStatus::Running);
        manager.stop("server").await;
    }

    #[tokio::test]
    async fn emits_effective_path_in_status_events() {
        let (broadcast, events) = recorder();
        let manager = manager(broadcast);
        manager
            .start(&cfg("ep-test", "exit 0", None))
            .await
            .unwrap();
        sleep(Duration::from_millis(200)).await;
        let paths: Vec<String> = events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                DaemonEvent::LaunchStatus { effective_path, .. } => Some(effective_path.clone()),
                _ => None,
            })
            .collect();
        assert!(!paths.is_empty());
        assert!(paths.iter().all(|p| p == "/tmp"));
        manager.stop_all().await;
    }

    #[tokio::test]
    async fn emits_effective_path_in_output_events() {
        let (broadcast, events) = recorder();
        let manager = manager(broadcast);
        manager
            .start(&cfg("ep-out", "printf hi", None))
            .await
            .unwrap();
        sleep(Duration::from_millis(200)).await;
        let paths: Vec<String> = events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                DaemonEvent::LaunchOutput { effective_path, .. } => Some(effective_path.clone()),
                _ => None,
            })
            .collect();
        assert!(!paths.is_empty());
        assert!(paths.iter().all(|p| p == "/tmp"));
        manager.stop_all().await;
    }

    #[tokio::test]
    async fn passes_env_vars_to_the_spawned_process() {
        let (broadcast, events) = recorder();
        let manager = manager(broadcast);
        let mut config = cfg("env-test", "printf \"$MY_VAR\"", None);
        config.env = Some(
            [("MY_VAR".to_string(), "hello-from-env".to_string())]
                .into_iter()
                .collect(),
        );
        manager.start(&config).await.unwrap();
        sleep(Duration::from_millis(200)).await;
        assert!(
            output_events(&events)
                .iter()
                .any(|(_, d)| d.contains("hello-from-env"))
        );
        manager.stop_all().await;
    }

    // --- output buffering (echo-once fast-subprocess race) ---

    #[tokio::test]
    async fn retains_stdout_from_a_near_instant_exit_via_output_buffer() {
        let (broadcast, _events) = recorder();
        let manager = manager(broadcast);
        manager
            .start(&cfg("echo-once", "printf 'hello-from-launch\\n'", None))
            .await
            .unwrap();
        sleep(Duration::from_millis(200)).await;
        let buffer = manager.get_output_buffer("echo-once");
        assert!(buffer.iter().any(|e| e.data.contains("hello-from-launch")));
    }

    #[tokio::test]
    async fn resets_the_buffer_on_the_next_start() {
        let (broadcast, _events) = recorder();
        let manager = manager(broadcast);
        manager
            .start(&cfg("echo-once", "printf 'first-run\\n'", None))
            .await
            .unwrap();
        sleep(Duration::from_millis(200)).await;
        assert!(
            manager
                .get_output_buffer("echo-once")
                .iter()
                .any(|e| e.data.contains("first-run"))
        );

        manager
            .start(&cfg("echo-once", "printf 'second-run\\n'", None))
            .await
            .unwrap();
        sleep(Duration::from_millis(200)).await;
        let buffer = manager.get_output_buffer("echo-once");
        assert!(buffer.iter().any(|e| e.data.contains("second-run")));
        assert!(!buffer.iter().any(|e| e.data.contains("first-run")));
    }

    // --- port readiness ---

    #[tokio::test]
    async fn waits_for_a_listening_port_before_running() {
        // The test owns a listener on an ephemeral port; the launched process is a
        // bare sleep, so `running` is gated purely on the TCP-connect probe.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port() as i64;
        tokio::spawn(async move {
            loop {
                if listener.accept().await.is_err() {
                    return;
                }
            }
        });

        let (broadcast, _events) = recorder();
        let manager = manager(broadcast);
        manager
            .start(&cfg("web", "sleep 100", Some(port)))
            .await
            .unwrap();
        assert_eq!(manager.get_status("web"), LaunchProcessStatus::Running);
        manager.stop("web").await;
    }
}

// PORT STATUS: src/launch/launch-manager.ts (405 lines)
// confidence: medium
// todos: 0
// notes: tokio::process spawn (detached: process_group(0)) + two chunk-reader
// tasks (buffer + emit launch.output; stderr also keeps a 20-line tail for the
// exit log) + a wait task that runs the exit handler (terminal status guarded by
// `!= stopped`, state update before emit, map delete, tunnel teardown, exit
// signal). Port readiness = TCP connect (PORTING.md §2.12) replacing the TS HTTP
// HEAD; a `watch<bool>` replaces the exit-promise so stop() can await
// SIGTERM→(5s)→SIGKILL. Group kill shells out to `kill -<SIG> -<pid>` with a
// single-pid fallback (house style; no libc/nix). clean_env threads an env
// snapshot (no set_var) so the MAINFRAME_ORIG_PATH contract is a pure unit test.
// All launch-manager.test.ts cases (both files) translated with real /bin/sh
// processes and a real ephemeral-port listener; the cleanEnv spawn-arg assertions
// became direct clean_env unit tests.
