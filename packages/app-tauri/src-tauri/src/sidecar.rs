/// Node daemon sidecar supervision.
///
/// Mirrors `packages/desktop/src/main/index.ts:startDaemon()`.
/// Spawns the daemon as a child process with `detached: false` semantics
/// (the child dies when this process dies — Rust's default).
/// The login-shell env is merged over the process env before spawn,
/// replicating `{ ...process.env, NODE_ENV: 'production', ...shellEnv }`.
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

pub struct DaemonHandle {
    child: Arc<Mutex<Option<Child>>>,
}

impl DaemonHandle {
    pub fn kill(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(ref mut child) = *guard {
                let _ = child.kill();
                tracing::info!("daemon sidecar killed");
            }
        }
    }

    pub fn pid(&self) -> Option<u32> {
        self.child
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|c| c.id()))
    }
}

pub struct SidecarConfig {
    /// Absolute path to the `node` binary.
    pub node_bin: PathBuf,
    /// Absolute path to the daemon entry point (e.g. `packages/core/dist/index.js`).
    pub daemon_entry: PathBuf,
    /// Login-shell env captured by `shell_env::resolve_shell_env_with_timeout`.
    pub shell_env: HashMap<String, String>,
    /// Daemon HTTP/WS port. Use a non-default (31500) to avoid colliding with dev.
    pub daemon_port: u16,
    /// Optional data dir override.
    pub data_dir: Option<PathBuf>,
}

/// Spawn the daemon sidecar. Returns a handle used to kill it on app exit.
///
/// Environment precedence (matching Electron's `startDaemon`):
///   base process env  ←  shell_env overlay  ←  explicit overrides
pub fn spawn_daemon(config: SidecarConfig) -> Result<DaemonHandle, String> {
    let mut cmd = Command::new(&config.node_bin);
    cmd.arg(&config.daemon_entry);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::inherit());
    cmd.stderr(Stdio::inherit());

    // Command inherits the parent env by default in Rust; no need to rebuild it.
    // 1. Overlay the login-shell env (wins over bare process env).
    for (k, v) in &config.shell_env {
        cmd.env(k, v);
    }

    // 2. Explicit overrides (win over everything).
    cmd.env("NODE_ENV", "production");
    cmd.env("DAEMON_PORT", config.daemon_port.to_string());
    if let Some(data_dir) = &config.data_dir {
        cmd.env("MAINFRAME_DATA_DIR", data_dir);
    }

    tracing::info!(
        node = %config.node_bin.display(),
        daemon = %config.daemon_entry.display(),
        port = config.daemon_port,
        path = %config.shell_env.get("PATH").map(|s| s.as_str()).unwrap_or("<not set>"),
        "spawning daemon sidecar"
    );

    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn daemon: {e}"))?;

    tracing::info!(pid = child.id(), "daemon sidecar started");

    Ok(DaemonHandle {
        child: Arc::new(Mutex::new(Some(child))),
    })
}

/// Resolve the `node` binary path from the login-shell env PATH.
/// Falls back to well-known nvm/homebrew locations if `which` fails.
pub fn find_node(shell_env_path: Option<&str>) -> Result<PathBuf, String> {
    // Try which(node) using the login-shell PATH.
    let path_env = shell_env_path
        .map(|s| s.to_string())
        .or_else(|| std::env::var("PATH").ok())
        .unwrap_or_default();

    // Walk PATH entries looking for `node`.
    for dir in path_env.split(':') {
        let candidate = PathBuf::from(dir).join("node");
        if candidate.is_file() {
            tracing::info!(node = %candidate.display(), "found node in PATH");
            return Ok(candidate);
        }
    }

    // Hard-coded fallback locations (homebrew, system). The nvm directory
    // is handled separately below with a proper semver-aware sort — it must
    // not appear here as a raw path because it is a directory, not a binary.
    let home = dirs::home_dir().unwrap_or_default();
    let fallbacks = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ];

    for fb in &fallbacks {
        let p = PathBuf::from(fb);
        if p.is_file() {
            tracing::info!(node = %p.display(), "found node via fallback");
            return Ok(p);
        }
    }

    // nvm: find the highest installed version using numeric semver comparison
    // so that v10 > v9 (lexical sort would give the wrong order).
    let nvm_dir = home.join(".nvm/versions/node");
    if nvm_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            let mut versions: Vec<_> = entries.filter_map(|e| e.ok()).collect();
            versions.sort_by(|a, b| {
                let ver = |e: &std::fs::DirEntry| -> Vec<u64> {
                    e.file_name()
                        .to_string_lossy()
                        .trim_start_matches('v')
                        .split('.')
                        .map(|p| p.parse::<u64>().unwrap_or(0))
                        .collect()
                };
                ver(a).cmp(&ver(b))
            });
            if let Some(last) = versions.last() {
                let candidate = last.path().join("bin/node");
                if candidate.is_file() {
                    tracing::info!(node = %candidate.display(), "found node in nvm versions");
                    return Ok(candidate);
                }
            }
        }
    }

    Err("node binary not found — install Node.js via nvm or homebrew".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// find_node must return a path that is_file(), never a directory.
    #[test]
    fn find_node_result_is_file() {
        // Use the real process PATH so we get an actual node binary.
        let path = std::env::var("PATH").ok();
        match find_node(path.as_deref()) {
            Ok(p) => {
                assert!(
                    p.is_file(),
                    "find_node returned a non-file path: {}",
                    p.display()
                );
            }
            Err(_) => {
                // Node not available in this environment — skip (not a test failure).
                eprintln!("find_node: node not found in PATH, skipping is_file assertion");
            }
        }
    }

    /// Semver sort: v10.x must rank higher than v9.x.
    #[test]
    fn nvm_sort_numeric_not_lexical() {
        // Simulate what the sort closure does by comparing version tuples directly.
        let parse = |s: &str| -> Vec<u64> {
            s.trim_start_matches('v')
                .split('.')
                .map(|p| p.parse::<u64>().unwrap_or(0))
                .collect()
        };
        let mut tags = vec!["v9.11.2", "v10.24.1", "v18.20.0", "v8.17.0"];
        tags.sort_by(|a, b| parse(a).cmp(&parse(b)));
        assert_eq!(
            tags.last(),
            Some(&"v18.20.0"),
            "expected v18.20.0 to sort last (highest)"
        );
        // Confirm v10 beats v9 under numeric sort.
        assert!(parse("v10.0.0") > parse("v9.11.2"));
    }
}
