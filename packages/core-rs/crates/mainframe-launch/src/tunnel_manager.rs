//! Ported from `src/tunnel/tunnel-manager.ts`.
//!
//! Spawns `cloudflared` per label, scans its stdout/stderr for the
//! `*.trycloudflare.com` URL and the "Registered tunnel connection" line, then
//! waits for DNS propagation before resolving. Emits `tunnel:status` DaemonEvents
//! at each phase and exposes `verify()` (a cached `/health` probe). The TS uses
//! two regexes and a `node:dns` resolver pinned to 1.1.1.1; no `regex` crate is
//! allowlisted (both patterns are hand-scanned) and no DNS resolver crate is
//! (system resolution via `tokio::net::lookup_host` stands in — see TODO(port)).
//!
//! CONCURRENCY.tsv: `tunnels` = `Arc<DashMap<String, ManagedTunnel>>` keyed by
//! label; `verifiedAt` = `Arc<DashMap<String, VerifyResult>>` (30s TTL cache).

use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use mainframe_types::events::{DaemonEvent, TunnelState};
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, BufReader, Lines};
use tokio::process::{ChildStderr, ChildStdout, Command};
use tokio::time::sleep;

use crate::process::{
    ChildRegistryPort, ManagedChildEntry, ManagedChildKind, NoopChildRegistry, now_ms,
};

/// Fire-and-forget DaemonEvent sink (TS `broadcast?: (event) => void`).
pub type BroadcastFn = Arc<dyn Fn(DaemonEvent) + Send + Sync>;

const REGISTERED_MARKER: &str = "Registered tunnel connection";
const CLOUDFLARED_NOT_FOUND: &str = "cloudflared not found. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";

/// Named/quick-tunnel start options (TS `TunnelStartOptions`).
#[derive(Debug, Clone, Default)]
pub struct TunnelStartOptions {
    pub token: Option<String>,
    pub url: Option<String>,
}

/// Registry + spawn-binary options (TS `TunnelManagerOptions`).
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

/// Tunable timings + binary path. Defaults match the TS constants; tests shrink
/// the timings and point `cloudflared_bin` at a stand-in script.
#[derive(Debug, Clone)]
pub struct TunnelConfig {
    pub cloudflared_bin: String,
    pub start_timeout: Duration,
    pub dns_poll: Duration,
    pub dns_timeout: Duration,
    pub verify_timeout: Duration,
    pub verify_cache_ttl: Duration,
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
        }
    }
}

struct ManagedTunnel {
    pid: Option<u32>,
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
    // Pids spawned but not yet promoted into `tunnels` (URL parsed + connection
    // registered). They live here for the up-to-45s start window so stop_all can
    // reap a mid-start child on shutdown instead of orphaning it to PID 1.
    pending: Arc<StdMutex<HashSet<u32>>>,
    verified_at: Arc<DashMap<String, VerifyResult>>,
    broadcast: BroadcastFn,
    config: TunnelConfig,
    client: reqwest::Client,
    /// Pidfile registry so a crashed daemon's next startup sweep can reap tunnels
    /// it leaked. Defaults to `NoopChildRegistry`.
    registry: Arc<dyn ChildRegistryPort>,
    /// Boot-resolved login-shell `PATH`, applied to the spawned `cloudflared` so
    /// packaged builds find it outside the bare launchd `PATH` (mirrors the TS
    /// `enrichPath` env mutation). `None` = inherit the daemon `PATH`.
    resolved_path: Option<String>,
}

impl TunnelManager {
    pub fn new(broadcast: Option<BroadcastFn>) -> Self {
        Self::with_config(broadcast, TunnelConfig::default())
    }

    pub fn with_config(broadcast: Option<BroadcastFn>, config: TunnelConfig) -> Self {
        Self {
            tunnels: Arc::new(DashMap::new()),
            pending: Arc::new(StdMutex::new(HashSet::new())),
            verified_at: Arc::new(DashMap::new()),
            broadcast: broadcast.unwrap_or_else(|| Arc::new(|_event| {})),
            config,
            client: reqwest::Client::new(),
            registry: Arc::new(NoopChildRegistry),
            resolved_path: None,
        }
    }

    /// Construct with a child registry + spawn-binary path (TS second ctor arg).
    /// `cloudflaredPath` sets the spawned binary (default bare `cloudflared`).
    pub fn with_options(broadcast: Option<BroadcastFn>, options: TunnelManagerOptions) -> Self {
        let mut config = TunnelConfig::default();
        if let Some(path) = options.cloudflared_path {
            config.cloudflared_bin = path;
        }
        let mut manager = Self::with_config(broadcast, config);
        if let Some(registry) = options.registry {
            manager.registry = registry;
        }
        manager
    }

    /// Inject the boot-resolved login-shell `PATH` (see
    /// `mainframe_runtime::ResolvedPath`) applied to the `cloudflared` spawn.
    #[must_use]
    pub fn with_resolved_path(mut self, path: impl Into<String>) -> Self {
        self.resolved_path = Some(path.into());
        self
    }

    /// Persist a spawned cloudflared pid so a crashed daemon's next startup sweep
    /// can reap it. Only absolute paths are tracked — reaping a bare-name match
    /// could kill an unrelated user process after PID reuse. Fire-and-forget.
    fn record_spawn(&self, label: &str, pid: Option<u32>) {
        let Some(entry) = tunnel_record_entry(&self.config.cloudflared_bin, pid, label) else {
            return;
        };
        let registry = self.registry.clone();
        tokio::spawn(async move {
            registry.add(entry).await;
        });
    }

    fn forget_spawn(&self, pid: Option<u32>) {
        let Some(pid) = pid else {
            return;
        };
        let registry = self.registry.clone();
        tokio::spawn(async move {
            registry.remove(i64::from(pid)).await;
        });
    }

    fn add_pending(&self, pid: Option<u32>) {
        if let Some(pid) = pid {
            self.pending
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(pid);
        }
    }

    fn drop_pending(&self, pid: Option<u32>) {
        if let Some(pid) = pid {
            self.pending
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&pid);
        }
    }

    /// Extract a `https://<label>.trycloudflare.com` URL from a log line, or
    /// `None`. Mirrors `/https:\/\/[a-z0-9-]+\.trycloudflare\.com/` — the label
    /// class is `[a-z0-9-]` (no `.`), so it stops at the first dot.
    pub fn parse_url(line: &str) -> Option<String> {
        let mut search_from = 0;
        while let Some(rel) = line[search_from..].find("https://") {
            let start = search_from + rel;
            let after = &line[start + "https://".len()..];
            let label_len: usize = after
                .chars()
                .take_while(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '-')
                .map(char::len_utf8)
                .sum();
            if label_len > 0 {
                let rest = &after[label_len..];
                if rest.starts_with(".trycloudflare.com") {
                    let label = &after[..label_len];
                    return Some(format!("https://{label}.trycloudflare.com"));
                }
            }
            search_from = start + "https://".len();
        }
        None
    }

    pub async fn start(
        &self,
        port: u16,
        label: &str,
        options: Option<TunnelStartOptions>,
    ) -> Result<String, String> {
        // Kill any existing tunnel for this label to prevent leaks.
        self.stop(label);

        let options = options.unwrap_or_default();
        let is_named = options.token.is_some();

        self.broadcast(DaemonEvent::TunnelStatus {
            state: TunnelState::Starting,
            label: label.to_string(),
            url: None,
            dns_verified: None,
            error: None,
        });

        let args: Vec<String> = if is_named {
            vec![
                "tunnel".to_string(),
                "run".to_string(),
                "--token".to_string(),
                options.token.clone().unwrap_or_default(),
            ]
        } else {
            vec![
                "tunnel".to_string(),
                "--url".to_string(),
                format!("http://localhost:{port}"),
            ]
        };

        let mut child = match build_cloudflared_command(
            &self.config.cloudflared_bin,
            &args,
            self.resolved_path.as_deref(),
        )
        .spawn()
        {
            Ok(child) => child,
            Err(err) => {
                let message = if err.kind() == std::io::ErrorKind::NotFound {
                    CLOUDFLARED_NOT_FOUND.to_string()
                } else {
                    err.to_string()
                };
                self.broadcast(DaemonEvent::TunnelStatus {
                    state: TunnelState::Error,
                    label: label.to_string(),
                    url: None,
                    dns_verified: None,
                    error: Some(message.clone()),
                });
                return Err(message);
            }
        };

        let pid = child.id();
        // Record the reap pid and mark the child pending BEFORE the start window,
        // so a shutdown or crash during it can reap the child (see stop_all).
        self.record_spawn(label, pid);
        self.add_pending(pid);
        let mut out_lines = child.stdout.take().map(|s| BufReader::new(s).lines());
        let mut err_lines = child.stderr.take().map(|s| BufReader::new(s).lines());

        let mut pending_url: Option<String> = if is_named { options.url.clone() } else { None };
        let mut registered = false;

        let start_deadline = sleep(self.config.start_timeout);
        tokio::pin!(start_deadline);

        // Phase 1: wait for URL + registration (or timeout / early exit).
        loop {
            if pending_url.is_some() && registered {
                break;
            }
            tokio::select! {
                line = next_line_stdout(&mut out_lines) => {
                    if let Some(line) = line {
                        self.scan_line(&line, is_named, label, &mut pending_url, &mut registered);
                    }
                }
                line = next_line_stderr(&mut err_lines) => {
                    if let Some(line) = line {
                        self.scan_line(&line, is_named, label, &mut pending_url, &mut registered);
                    }
                }
                () = &mut start_deadline => {
                    kill_pid(pid, "-TERM");
                    self.forget_spawn(pid);
                    self.drop_pending(pid);
                    let msg = format!(
                        "Tunnel \"{label}\" timed out after {}ms",
                        self.config.start_timeout.as_millis()
                    );
                    self.broadcast(DaemonEvent::TunnelStatus {
                        state: TunnelState::Error,
                        label: label.to_string(),
                        url: None,
                        dns_verified: None,
                        error: Some(msg.clone()),
                    });
                    return Err(msg);
                }
                status = child.wait() => {
                    self.forget_spawn(pid);
                    self.drop_pending(pid);
                    return Err(self.on_exit_before_ready(label, status));
                }
            }
        }

        // Phase 2: connected. Register the tunnel, then wait for DNS while still
        // watching for an early exit (which rejects, per the TS `!done` branch).
        let url = pending_url.unwrap_or_default();
        self.tunnels.insert(
            label.to_string(),
            ManagedTunnel {
                pid,
                url: url.clone(),
                ready: false,
            },
        );
        // Promoted into `tunnels`; no longer a pending mid-start child.
        self.drop_pending(pid);
        tracing::info!(target: "tunnel", label, url, port, "tunnel connected, waiting for DNS propagation…");
        self.broadcast(DaemonEvent::TunnelStatus {
            state: TunnelState::Ready,
            label: label.to_string(),
            url: Some(url.clone()),
            dns_verified: Some(false),
            error: None,
        });

        tokio::select! {
            dns_ok = self.wait_for_dns(&url) => {
                if let Some(mut tunnel) = self.tunnels.get_mut(label) {
                    tunnel.ready = true;
                }
                if dns_ok {
                    tracing::info!(target: "tunnel", label, url, "tunnel ready (DNS verified)");
                } else {
                    tracing::warn!(target: "tunnel", label, url, "tunnel DNS verification timed out, emitting anyway");
                }
                self.broadcast(DaemonEvent::TunnelStatus {
                    state: TunnelState::DnsVerified,
                    label: label.to_string(),
                    url: Some(url.clone()),
                    dns_verified: Some(dns_ok),
                    error: None,
                });
                self.spawn_exit_watcher(label.to_string(), pid, child);
                Ok(url)
            }
            status = child.wait() => {
                self.forget_spawn(pid);
                Err(self.on_exit_before_ready(label, status))
            }
        }
    }

    fn scan_line(
        &self,
        line: &str,
        is_named: bool,
        label: &str,
        pending_url: &mut Option<String>,
        registered: &mut bool,
    ) {
        if !is_named
            && pending_url.is_none()
            && let Some(url) = Self::parse_url(line)
        {
            tracing::debug!(target: "tunnel", label, url, "tunnel URL received, waiting for connection registration…");
            *pending_url = Some(url);
        }
        if !*registered && line.contains(REGISTERED_MARKER) {
            tracing::debug!(target: "tunnel", label, "tunnel connection registered");
            *registered = true;
        }
    }

    fn on_exit_before_ready(
        &self,
        label: &str,
        status: std::io::Result<std::process::ExitStatus>,
    ) -> String {
        let code = status
            .ok()
            .and_then(|s| s.code())
            .map(|c| c.to_string())
            .unwrap_or_else(|| "null".to_string());
        let msg = format!("Tunnel \"{label}\" process exited before ready (code {code})");
        self.broadcast(DaemonEvent::TunnelStatus {
            state: TunnelState::Error,
            label: label.to_string(),
            url: None,
            dns_verified: None,
            error: Some(msg.clone()),
        });
        msg
    }

    /// Post-ready exit handling (TS `child.once('exit')` `else` branch): forget
    /// the reap pid, remove the tunnel, and broadcast `stopped` when the
    /// established child dies.
    fn spawn_exit_watcher(
        &self,
        label: String,
        pid: Option<u32>,
        mut child: tokio::process::Child,
    ) {
        let tunnels = self.tunnels.clone();
        let broadcast = self.broadcast.clone();
        let registry = self.registry.clone();
        tokio::spawn(async move {
            let status = child.wait().await;
            if let Some(pid) = pid {
                registry.remove(i64::from(pid)).await;
            }
            let code = status.ok().and_then(|s| s.code());
            tracing::info!(target: "tunnel", label = %label, code = ?code, "tunnel process exited");
            tunnels.remove(&label);
            broadcast(DaemonEvent::TunnelStatus {
                state: TunnelState::Stopped,
                label,
                url: None,
                dns_verified: None,
                error: None,
            });
        });
    }

    pub fn stop(&self, label: &str) {
        let Some((_, tunnel)) = self.tunnels.remove(label) else {
            return;
        };
        kill_pid(tunnel.pid, "-TERM");
        self.forget_spawn(tunnel.pid);
        tracing::info!(target: "tunnel", label, "tunnel stopped");
        self.broadcast(DaemonEvent::TunnelStatus {
            state: TunnelState::Stopped,
            label: label.to_string(),
            url: None,
            dns_verified: None,
            error: None,
        });
    }

    pub fn stop_all(&self) {
        let labels: Vec<String> = self.tunnels.iter().map(|e| e.key().clone()).collect();
        for label in labels {
            self.stop(&label);
        }
        // Reap children still mid-start: they aren't in `tunnels` yet, so the loop
        // above misses them. Their own exit path prunes `pending` afterwards.
        let pending: Vec<u32> = {
            let mut set = self
                .pending
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            set.drain().collect()
        };
        for pid in pending {
            kill_pid(Some(pid), "-TERM");
            self.forget_spawn(Some(pid));
        }
    }

    pub fn get_url(&self, label: &str) -> Option<String> {
        self.tunnels.get(label).map(|t| t.url.clone())
    }

    pub async fn verify(&self, label: &str) -> bool {
        if let Some(cached) = self.verified_at.get(label)
            && cached.checked_at.elapsed() < self.config.verify_cache_ttl
        {
            tracing::debug!(target: "tunnel", label, reachable = cached.reachable, "verify cache hit");
            return cached.reachable;
        }

        let url = {
            let Some(tunnel) = self.tunnels.get(label) else {
                return false;
            };
            if !tunnel.ready {
                return false;
            }
            tunnel.url.clone()
        };

        match self
            .client
            .get(format!("{url}/health"))
            .timeout(self.config.verify_timeout)
            .send()
            .await
        {
            Ok(res) => {
                if !res.status().is_success() {
                    tracing::debug!(target: "tunnel", label, status = res.status().as_u16(), "verify failed: non-200");
                    self.verified_at.insert(
                        label.to_string(),
                        VerifyResult {
                            reachable: false,
                            checked_at: Instant::now(),
                        },
                    );
                    return false;
                }
                match res.json::<HealthBody>().await {
                    Ok(body) => {
                        let reachable = body.status.as_deref() == Some("ok");
                        tracing::debug!(target: "tunnel", label, reachable, "verify result");
                        self.verified_at.insert(
                            label.to_string(),
                            VerifyResult {
                                reachable,
                                checked_at: Instant::now(),
                            },
                        );
                        reachable
                    }
                    // Non-JSON body → TS `await res.json()` throws → outer catch →
                    // false, and (unlike the non-200 path) no cache write.
                    Err(err) => {
                        tracing::debug!(target: "tunnel", label, ?err, "verify failed: network error");
                        false
                    }
                }
            }
            Err(err) => {
                tracing::debug!(target: "tunnel", label, ?err, "verify failed: network error");
                false
            }
        }
    }

    /// Poll system DNS until the tunnel hostname resolves. Returns `true` on
    /// resolution, `false` on timeout (TS `waitForDns` resolve/reject).
    async fn wait_for_dns(&self, url: &str) -> bool {
        let hostname = extract_hostname(url);
        let start = Instant::now();
        loop {
            if start.elapsed() > self.config.dns_timeout {
                return false;
            }
            if let Ok(mut addrs) = tokio::net::lookup_host((hostname.as_str(), 443u16)).await
                && addrs.next().is_some()
            {
                return true;
            }
            sleep(self.config.dns_poll).await;
        }
    }

    fn broadcast(&self, event: DaemonEvent) {
        (self.broadcast)(event);
    }
}

/// Signal a pid by shelling out to `kill` (house style — no `libc`/`nix`).
fn kill_pid(pid: Option<u32>, flag: &'static str) {
    let Some(pid) = pid else {
        return;
    };
    tokio::spawn(async move {
        let _ = Command::new("kill")
            .arg(flag)
            .arg(pid.to_string())
            .status()
            .await;
    });
}

fn extract_hostname(url: &str) -> String {
    let after = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);
    after.split(['/', ':']).next().unwrap_or(after).to_string()
}

async fn next_line_stdout(lines: &mut Option<Lines<BufReader<ChildStdout>>>) -> Option<String> {
    match lines {
        Some(l) => match l.next_line().await {
            Ok(Some(line)) => Some(line),
            _ => {
                *lines = None;
                None
            }
        },
        None => std::future::pending().await,
    }
}

async fn next_line_stderr(lines: &mut Option<Lines<BufReader<ChildStderr>>>) -> Option<String> {
    match lines {
        Some(l) => match l.next_line().await {
            Ok(Some(line)) => Some(line),
            _ => {
                *lines = None;
                None
            }
        },
        None => std::future::pending().await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn recorder() -> (BroadcastFn, Arc<Mutex<Vec<DaemonEvent>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let f: BroadcastFn = Arc::new(move |ev| sink.lock().unwrap().push(ev));
        (f, events)
    }

    /// The boot-resolved login-shell PATH must land in the spawned `cloudflared`
    /// command's env (packaged apps otherwise ENOENT on homebrew-installed
    /// `cloudflared`).
    #[test]
    fn cloudflared_command_carries_the_resolved_path() {
        let cmd = build_cloudflared_command(
            "cloudflared",
            &["tunnel".to_string()],
            Some("/opt/homebrew/bin:/usr/bin"),
        );
        let path = cmd
            .as_std()
            .get_envs()
            .find(|(k, _)| *k == std::ffi::OsStr::new("PATH"))
            .and_then(|(_, v)| v)
            .map(|v| v.to_string_lossy().into_owned());
        assert_eq!(path.as_deref(), Some("/opt/homebrew/bin:/usr/bin"));
    }

    fn stopped_broadcasts(events: &Arc<Mutex<Vec<DaemonEvent>>>) -> usize {
        events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| {
                matches!(
                    e,
                    DaemonEvent::TunnelStatus {
                        state: TunnelState::Stopped,
                        ..
                    }
                )
            })
            .count()
    }

    // --- parseUrl ---

    #[test]
    fn parse_url_extracts_from_a_log_line() {
        let line = "2024-01-01T00:00:00Z INF | Your quick Tunnel has been created! Visit it at:  https://abc-def-ghi.trycloudflare.com";
        assert_eq!(
            TunnelManager::parse_url(line).as_deref(),
            Some("https://abc-def-ghi.trycloudflare.com")
        );
    }

    #[test]
    fn parse_url_extracts_from_a_plain_line() {
        let line = "https://some-tunnel-name.trycloudflare.com";
        assert_eq!(
            TunnelManager::parse_url(line).as_deref(),
            Some("https://some-tunnel-name.trycloudflare.com")
        );
    }

    #[test]
    fn parse_url_returns_none_when_absent() {
        assert_eq!(TunnelManager::parse_url("2024 INF Starting tunnel"), None);
    }

    #[test]
    fn parse_url_returns_none_for_http() {
        assert_eq!(
            TunnelManager::parse_url("http://abc-def.trycloudflare.com"),
            None
        );
    }

    #[test]
    fn parse_url_returns_none_for_a_different_domain() {
        assert_eq!(
            TunnelManager::parse_url("https://example.cloudflare.com"),
            None
        );
    }

    #[test]
    fn parse_url_returns_none_for_empty_string() {
        assert_eq!(TunnelManager::parse_url(""), None);
    }

    // --- lifecycle ---

    #[tokio::test]
    async fn get_url_returns_none_for_unknown_label() {
        let manager = TunnelManager::new(None);
        assert_eq!(manager.get_url("daemon"), None);
        assert_eq!(manager.get_url("preview:Dev Server"), None);
    }

    #[tokio::test]
    async fn stop_is_a_no_op_for_unknown_label() {
        let manager = TunnelManager::new(None);
        manager.stop("nonexistent"); // must not panic
    }

    #[tokio::test]
    async fn stop_all_is_a_no_op_when_no_tunnels_running() {
        let manager = TunnelManager::new(None);
        manager.stop_all(); // must not panic
    }

    // --- broadcast callbacks ---

    #[tokio::test]
    async fn broadcasts_stopped_when_stop_called_for_a_running_tunnel() {
        let (broadcast, events) = recorder();
        let manager = TunnelManager::new(Some(broadcast));
        manager.tunnels.insert(
            "daemon".to_string(),
            ManagedTunnel {
                pid: None,
                url: "https://test.trycloudflare.com".to_string(),
                ready: true,
            },
        );
        events.lock().unwrap().clear();
        manager.stop("daemon");
        let evs = events.lock().unwrap();
        assert_eq!(evs.len(), 1);
        assert!(matches!(
            &evs[0],
            DaemonEvent::TunnelStatus { state: TunnelState::Stopped, label, .. } if label == "daemon"
        ));
    }

    #[tokio::test]
    async fn does_not_broadcast_when_stop_called_for_unknown_label() {
        let (broadcast, events) = recorder();
        let manager = TunnelManager::new(Some(broadcast));
        manager.stop("nonexistent");
        assert!(events.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn works_without_a_broadcast_callback() {
        let manager = TunnelManager::new(None);
        manager.stop("nonexistent"); // must not panic
    }

    // --- verify (canned local HTTP server) ---

    /// Serve `count`-bounded canned HTTP responses, returning the base URL and a
    /// shared hit counter. Each connection gets one response with `Connection:
    /// close` so reqwest opens a fresh connection per request.
    async fn serve_canned(
        status_line: &'static str,
        body: &'static str,
    ) -> (String, Arc<std::sync::atomic::AtomicUsize>) {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let hits = Arc::new(AtomicUsize::new(0));
        let hits2 = hits.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                hits2.fetch_add(1, Ordering::SeqCst);
                let mut buf = [0u8; 1024];
                let _ = socket.read(&mut buf).await;
                let response = format!(
                    "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            }
        });
        (format!("http://{addr}"), hits)
    }

    fn insert_ready(manager: &TunnelManager, label: &str, url: &str) {
        manager.tunnels.insert(
            label.to_string(),
            ManagedTunnel {
                pid: None,
                url: url.to_string(),
                ready: true,
            },
        );
    }

    #[tokio::test]
    async fn verify_false_when_no_tunnel() {
        let manager = TunnelManager::new(None);
        assert!(!manager.verify("daemon").await);
    }

    #[tokio::test]
    async fn verify_false_when_not_ready_without_fetching() {
        let (base, hits) = serve_canned("200 OK", "{\"status\":\"ok\"}").await;
        let manager = TunnelManager::new(None);
        manager.tunnels.insert(
            "daemon".to_string(),
            ManagedTunnel {
                pid: None,
                url: base,
                ready: false,
            },
        );
        assert!(!manager.verify("daemon").await);
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn verify_true_when_health_is_200_and_status_ok() {
        let (base, _hits) = serve_canned("200 OK", "{\"status\":\"ok\"}").await;
        let manager = TunnelManager::new(None);
        insert_ready(&manager, "daemon", &base);
        assert!(manager.verify("daemon").await);
    }

    #[tokio::test]
    async fn verify_false_on_network_error() {
        // Point at a closed port (nothing listening) → reqwest connect error.
        let manager = TunnelManager::new(None);
        insert_ready(&manager, "daemon", "http://127.0.0.1:1");
        assert!(!manager.verify("daemon").await);
    }

    #[tokio::test]
    async fn verify_false_on_non_200() {
        let (base, _hits) = serve_canned("502 Bad Gateway", "Bad Gateway").await;
        let manager = TunnelManager::new(None);
        insert_ready(&manager, "daemon", &base);
        assert!(!manager.verify("daemon").await);
    }

    #[tokio::test]
    async fn verify_false_when_body_status_not_ok() {
        let (base, _hits) = serve_canned("200 OK", "{\"status\":\"error\"}").await;
        let manager = TunnelManager::new(None);
        insert_ready(&manager, "daemon", &base);
        assert!(!manager.verify("daemon").await);
    }

    #[tokio::test]
    async fn verify_caches_success_within_ttl() {
        let (base, hits) = serve_canned("200 OK", "{\"status\":\"ok\"}").await;
        let manager = TunnelManager::new(None);
        insert_ready(&manager, "daemon", &base);
        assert!(manager.verify("daemon").await);
        assert!(manager.verify("daemon").await);
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn verify_refetches_after_cache_ttl() {
        let (base, hits) = serve_canned("200 OK", "{\"status\":\"ok\"}").await;
        let config = TunnelConfig {
            verify_cache_ttl: Duration::from_millis(30),
            ..TunnelConfig::default()
        };
        let manager = TunnelManager::with_config(None, config);
        insert_ready(&manager, "daemon", &base);
        assert!(manager.verify("daemon").await);
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1);
        sleep(Duration::from_millis(50)).await;
        assert!(manager.verify("daemon").await);
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    // --- start: DNS wait outlasts the (post-connection cleared) start timeout ---

    /// Write an executable stand-in for `cloudflared` that prints the URL + the
    /// registration line, then sleeps so the child stays alive.
    fn write_fake_cloudflared(dir: &std::path::Path) -> String {
        let script = dir.join("fake-cloudflared.sh");
        std::fs::write(
            &script,
            "#!/bin/sh\necho 'https://abc-def.trycloudflare.com'\necho 'Registered tunnel connection'\nsleep 100\n",
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script.to_string_lossy().into_owned()
    }

    #[tokio::test]
    async fn start_resolves_with_url_when_dns_outlasts_the_start_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let bin = write_fake_cloudflared(dir.path());
        let (broadcast, events) = recorder();
        // start_timeout is short, but must NOT fire once connected; DNS never
        // resolves (fake host) so the grace path resolves with the URL anyway.
        let config = TunnelConfig {
            cloudflared_bin: bin,
            start_timeout: Duration::from_millis(3_000),
            dns_poll: Duration::from_millis(20),
            dns_timeout: Duration::from_millis(150),
            ..TunnelConfig::default()
        };
        let manager = TunnelManager::with_config(Some(broadcast), config);

        let url = manager.start(3000, "daemon", None).await.unwrap();
        assert_eq!(url, "https://abc-def.trycloudflare.com");

        // A dns_verified{dnsVerified:false} status was broadcast (grace path).
        {
            let evs = events.lock().unwrap();
            assert!(evs.iter().any(|e| matches!(
                e,
                DaemonEvent::TunnelStatus {
                    state: TunnelState::DnsVerified,
                    dns_verified: Some(false),
                    ..
                }
            )));
        }

        // Tunnel is registered and marked ready; clean up the sleeping child.
        assert_eq!(
            manager.get_url("daemon").as_deref(),
            Some("https://abc-def.trycloudflare.com")
        );
        manager.stop("daemon");
        // stop() broadcasts stopped; the killed child's watcher broadcasts a
        // second stopped shortly after (faithful to the TS double-broadcast).
        sleep(Duration::from_millis(50)).await;
        assert!(stopped_broadcasts(&events) >= 1);
    }

    // --- registry tracking ---

    use crate::process::{BoxFuture, ManagedChildEntry, ManagedChildKind};

    struct RecordingRegistry {
        added: Mutex<Vec<ManagedChildEntry>>,
        removed: Mutex<Vec<i64>>,
    }

    impl RecordingRegistry {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                added: Mutex::new(vec![]),
                removed: Mutex::new(vec![]),
            })
        }
        fn added(&self) -> Vec<ManagedChildEntry> {
            self.added.lock().unwrap().clone()
        }
        fn removed(&self) -> Vec<i64> {
            self.removed.lock().unwrap().clone()
        }
    }

    impl ChildRegistryPort for RecordingRegistry {
        fn add(&self, entry: ManagedChildEntry) -> BoxFuture<'_, ()> {
            Box::pin(async move {
                self.added.lock().unwrap().push(entry);
            })
        }
        fn remove(&self, pid: i64) -> BoxFuture<'_, ()> {
            Box::pin(async move {
                self.removed.lock().unwrap().push(pid);
            })
        }
        fn list(&self) -> BoxFuture<'_, Vec<ManagedChildEntry>> {
            Box::pin(async { vec![] })
        }
        fn list_by_kind(&self, _kind: ManagedChildKind) -> BoxFuture<'_, Vec<ManagedChildEntry>> {
            Box::pin(async { vec![] })
        }
        fn clear(&self) -> BoxFuture<'_, ()> {
            Box::pin(async {})
        }
    }

    fn manager_with(config: TunnelConfig, registry: Arc<dyn ChildRegistryPort>) -> TunnelManager {
        let mut manager = TunnelManager::with_config(None, config);
        manager.registry = registry;
        manager
    }

    /// `cloudflared` stand-in that only sleeps — never prints a URL, so the tunnel
    /// stays mid-start (in `pending`, not promoted into `tunnels`).
    fn write_silent_cloudflared(dir: &std::path::Path) -> String {
        let script = dir.join("silent-cloudflared.sh");
        std::fs::write(&script, "#!/bin/sh\nsleep 100\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script.to_string_lossy().into_owned()
    }

    #[test]
    fn record_entry_records_with_the_absolute_binary_path() {
        let entry = tunnel_record_entry("/abs/bin/cloudflared", Some(4242), "preview:Dev").unwrap();
        assert_eq!(entry.pid, 4242);
        assert_eq!(entry.kind, ManagedChildKind::Tunnel);
        assert_eq!(entry.command, "/abs/bin/cloudflared");
        assert_eq!(entry.label, "preview:Dev");
        assert!(!entry.group);
        assert_eq!(entry.cwd, None);
    }

    #[test]
    fn record_entry_none_when_the_cloudflared_path_is_a_bare_name() {
        assert!(tunnel_record_entry("cloudflared", Some(4242), "preview:Dev").is_none());
    }

    #[test]
    fn record_entry_none_when_the_child_has_no_pid() {
        assert!(tunnel_record_entry("/abs/bin/cloudflared", None, "preview:Dev").is_none());
    }

    #[tokio::test]
    async fn records_the_spawned_pid_and_forgets_it_on_stop() {
        let dir = tempfile::tempdir().unwrap();
        let bin = write_fake_cloudflared(dir.path());
        let registry = RecordingRegistry::new();
        let config = TunnelConfig {
            cloudflared_bin: bin.clone(),
            dns_poll: Duration::from_millis(20),
            dns_timeout: Duration::from_millis(100),
            ..TunnelConfig::default()
        };
        let manager = manager_with(config, registry.clone());

        manager.start(4173, "preview:Dev", None).await.unwrap();
        sleep(Duration::from_millis(50)).await; // let the fire-and-forget add() run

        let added = registry.added();
        assert_eq!(added.len(), 1);
        assert_eq!(added[0].kind, ManagedChildKind::Tunnel);
        assert_eq!(added[0].command, bin);
        assert_eq!(added[0].label, "preview:Dev");
        assert!(!added[0].group);
        let pid = added[0].pid;

        manager.stop("preview:Dev");
        sleep(Duration::from_millis(50)).await;
        assert!(registry.removed().contains(&pid));
    }

    #[tokio::test]
    async fn stop_all_reaps_a_child_still_mid_start_and_forgets_its_pid() {
        let dir = tempfile::tempdir().unwrap();
        let bin = write_silent_cloudflared(dir.path());
        let registry = RecordingRegistry::new();
        let config = TunnelConfig {
            cloudflared_bin: bin,
            start_timeout: Duration::from_millis(5_000),
            ..TunnelConfig::default()
        };
        let manager = Arc::new(manager_with(config, registry.clone()));

        let start_manager = manager.clone();
        let task = tokio::spawn(async move {
            let _ = start_manager.start(4173, "preview:Dev", None).await;
        });

        // Wait for the child to spawn and record (never promotes — silent bin).
        let mut pid = None;
        for _ in 0..40 {
            let added = registry.added();
            if let Some(entry) = added.first() {
                pid = Some(entry.pid);
                break;
            }
            sleep(Duration::from_millis(25)).await;
        }
        let pid = pid.expect("child should have recorded a pid while mid-start");

        manager.stop_all();
        sleep(Duration::from_millis(100)).await;
        assert!(registry.removed().contains(&pid));
        task.abort();
    }
}

// PORT STATUS: src/tunnel/tunnel-manager.ts (245 lines)
// confidence: medium
// todos: 1
// notes: cloudflared spawn (tokio::process, kill_on_drop) + line scan for the
// trycloudflare URL (hand-scanned, no regex) and the "Registered tunnel
// connection" marker. The TS callback state machine is linearized: Phase 1
// select loop (stdout/stderr lines vs start-timeout vs early-exit) → Phase 2
// select (waitForDns vs early-exit), so the start timeout is naturally "cleared"
// once connected (regression the 45s-timeout test pins). Post-ready exit → a
// spawned watcher removes the tunnel + broadcasts stopped (the `!done ? reject :
// delete+stopped` split preserved). stop() shells out to `kill` (house style) and
// the killed child's watcher re-broadcasts stopped (faithful double-broadcast).
// verify() = reqwest GET /health with the 30s TTL cache (non-200 caches false;
// non-JSON/network error returns false without caching). TODO(port): waitForDns
// uses tokio::net::lookup_host (system resolver) — the TS pins 1.1.1.1 via
// node:dns Resolver; the specific-resolver behavior is lost (see blockers).
// Tunnel/verify tests use real spawned processes / a canned local HTTP server,
// not code mocks.
// #431/#442 child-reaping: TunnelManagerOptions{registry,cloudflaredPath} added;
// recordSpawn/forgetSpawn fire-and-forget against an Arc<dyn ChildRegistryPort>
// (absolute paths only, via tunnel_record_entry); a `pending` HashSet<pid> tracks
// mid-start children so stop_all reaps them (the mock-spawn TS tests map to the
// pure tunnel_record_entry unit tests + real-process record/stop/mid-start-reap
// tests, matching the crate's real-process test idiom).
