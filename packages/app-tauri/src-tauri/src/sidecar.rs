/// Node daemon sidecar supervision.
///
/// Mirrors `packages/app-electron/src/main/index.ts:startDaemon()`.
/// Spawns the daemon as a child process with `detached: false` semantics
/// (the child dies when this process dies — Rust's default).
/// The login-shell env is merged over the process env before spawn, then
/// app-owned daemon settings are reapplied.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

/// A real sidecar binary (Node runtime, or the Rust `mainframe-daemon`) is
/// several MB; this floor rejects the zero-byte `binaries/<name>-<triple>`
/// scaffold placeholders that may sit next to the exe in a dev build (spawning
/// a zero-byte file would fail at runtime).
const MIN_SIDECAR_BIN_BYTES: u64 = 1024;

#[derive(Debug, PartialEq, Eq)]
enum EnvOverride {
    Set(&'static str, String),
    Remove(&'static str),
}

pub struct DaemonHandle {
    child: Arc<Mutex<Option<Child>>>,
}

impl DaemonHandle {
    /// A no-op handle for when the daemon is EXTERNAL (started by the user / a
    /// separate process, not spawned by us — `MAINFRAME_EXTERNAL_DAEMON`). Holds
    /// no child, so `kill()` is a no-op and `pid()` is `None`.
    pub fn external() -> Self {
        DaemonHandle {
            child: Arc::new(Mutex::new(None)),
        }
    }

    pub fn kill(&self) {
        if let Ok(mut guard) = self.child.lock() {
            // take() empties the slot so the exit watcher knows this death was
            // intentional; wait() reaps the child (no <defunct> zombie).
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
                tracing::info!("daemon sidecar killed");
            }
        }
    }

    /// Watch for the child dying on its own (bind failure, crash). Polls
    /// `try_wait` so it never contends with `kill()` for more than an instant;
    /// an empty slot means `kill()` already ran (or the daemon is external) and
    /// the watcher just stops. On an unexpected exit the child is reaped, the
    /// slot cleared (so `get_daemon_status` reports "exited", not a live pid),
    /// and `on_exit` is invoked with the exit code.
    pub fn watch_exit<F>(&self, on_exit: F)
    where
        F: FnOnce(Option<i32>) + Send + 'static,
    {
        let child = Arc::clone(&self.child);
        std::thread::spawn(move || {
            let mut on_exit = Some(on_exit);
            loop {
                {
                    let mut guard = match child.lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                    match guard.as_mut() {
                        None => return, /* expected — killed on app exit or external daemon */
                        Some(c) => match c.try_wait() {
                            Ok(Some(status)) => {
                                let code = status.code();
                                *guard = None;
                                drop(guard);
                                if let Some(f) = on_exit.take() {
                                    f(code);
                                }
                                return;
                            }
                            Ok(None) => {}
                            Err(e) => {
                                tracing::warn!(err = %e, "daemon exit watch failed");
                                return;
                            }
                        },
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
        });
    }

    pub fn pid(&self) -> Option<u32> {
        self.child
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|c| c.id()))
    }
}

/// Which daemon implementation to spawn (the `MAINFRAME_DAEMON_IMPL` canary).
///
/// Both variants funnel through the same [`spawn_daemon`] → [`DaemonHandle`], so
/// kill/restart semantics are identical regardless of impl.
pub enum DaemonProgram {
    /// The Node sidecar: `node <daemon_entry>` (the default, always-working path).
    Node {
        /// Absolute path to the `node` binary.
        node_bin: PathBuf,
        /// Absolute path to the daemon entry (e.g. `packages/core/dist/index.js`).
        daemon_entry: PathBuf,
    },
    /// The Rust `mainframe-daemon` binary, run directly.
    Rust {
        /// Absolute path to the `mainframe-daemon` executable.
        daemon_bin: PathBuf,
        /// Bundled Node runtime, exposed to the Rust daemon as
        /// `MAINFRAME_BUNDLED_NODE` so it can launch the bundled LSP servers.
        /// `None` in dev / run-from-source (only external LSP servers spawn).
        bundled_node: Option<PathBuf>,
        /// Bundled `node_modules` root holding the LSP servers, exposed as
        /// `MAINFRAME_BUNDLED_LSP_ROOT`. `None` when the bundle is absent.
        bundled_lsp_root: Option<PathBuf>,
    },
}

pub struct SidecarConfig {
    /// The implementation-specific program to spawn.
    pub program: DaemonProgram,
    /// Login-shell env captured by `shell_env::resolve_shell_env_with_timeout`.
    /// Becomes the daemon's own env, so the daemon AND its adapter children
    /// (claude/codex) inherit the resolved PATH — closing the packaged-app
    /// "bare PATH → CLI ENOENT" gap for both impls.
    pub shell_env: HashMap<String, String>,
    /// Daemon HTTP/WS port.
    pub daemon_port: u16,
    /// Optional data dir override.
    pub data_dir: Option<PathBuf>,
}

/// Spawn the daemon sidecar (Node or Rust). Returns a handle used to kill it on
/// app exit — identical for both impls.
///
/// Environment precedence (matching Electron's `startDaemon`):
///   base process env  ←  shell_env overlay  ←  app-owned daemon overrides
pub fn spawn_daemon(config: SidecarConfig) -> Result<DaemonHandle, String> {
    let mut cmd = match &config.program {
        DaemonProgram::Node {
            node_bin,
            daemon_entry,
        } => {
            let mut c = Command::new(node_bin);
            c.arg(daemon_entry);
            // NODE_ENV matters only to the Node daemon; harmless but pointless
            // for the Rust binary, so it is set on the Node arm only.
            c.env("NODE_ENV", "production");
            c
        }
        DaemonProgram::Rust {
            daemon_bin,
            bundled_node,
            bundled_lsp_root,
        } => {
            let mut c = Command::new(daemon_bin);
            // The Rust daemon has no Node module resolver, so the bundled Node
            // runtime + node_modules root are injected via env; unset in dev, so
            // only external LSP servers (jdtls) spawn there.
            if let Some(node) = bundled_node {
                c.env("MAINFRAME_BUNDLED_NODE", node);
            }
            if let Some(root) = bundled_lsp_root {
                c.env("MAINFRAME_BUNDLED_LSP_ROOT", root);
            }
            c
        }
    };

    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::inherit());
    cmd.stderr(Stdio::inherit());

    // Command inherits the parent env by default in Rust; no need to rebuild it.
    // 1. Overlay the login-shell env (wins over bare process env).
    for (k, v) in &config.shell_env {
        cmd.env(k, v);
    }

    for env_override in daemon_env_overrides(config.daemon_port, config.data_dir.as_deref()) {
        match env_override {
            EnvOverride::Set(key, value) => {
                cmd.env(key, value);
            }
            EnvOverride::Remove(key) => {
                cmd.env_remove(key);
            }
        }
    }

    let program = match &config.program {
        DaemonProgram::Node { node_bin, .. } => node_bin.display().to_string(),
        DaemonProgram::Rust { daemon_bin, .. } => daemon_bin.display().to_string(),
    };
    tracing::info!(
        program = %program,
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

fn daemon_env_overrides(daemon_port: u16, data_dir: Option<&Path>) -> Vec<EnvOverride> {
    let port = daemon_port.to_string();
    let mut overrides = vec![
        EnvOverride::Set("NODE_ENV", "production".to_string()),
        EnvOverride::Set("DAEMON_PORT", port.clone()),
        EnvOverride::Set("VITE_DAEMON_HTTP_PORT", port.clone()),
        EnvOverride::Set("VITE_DAEMON_WS_PORT", port),
    ];

    match data_dir {
        Some(data_dir) => overrides.push(EnvOverride::Set(
            "MAINFRAME_DATA_DIR",
            data_dir.to_string_lossy().into_owned(),
        )),
        None => overrides.push(EnvOverride::Remove("MAINFRAME_DATA_DIR")),
    }

    overrides
}

/// Prefer the bundled Node sidecar in a packaged build.
///
/// Tauri's `externalBin` ("binaries/node") places the matching-triple Node binary
/// next to the app executable (`node` once the bundle strips the triple, or
/// `node-<triple>` in some layouts). Using it guarantees the daemon runs under the
/// pinned, ABI-matched Node we shipped — never the user's (possibly absent or
/// mismatched) system Node. Returns `None` when no sidecar sits next to the exe,
/// so the caller falls back to `find_node` (system Node).
///
/// NOTE: `boot_daemon` only CONSULTS this in release builds (`cfg!(debug_assertions)`
/// gate) — dev always uses system Node so live `packages/core` edits take effect,
/// even if leftover bundle artifacts sit in `target/debug`.
pub fn find_bundled_node() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    find_bundled_node_in(exe.parent()?)
}

/// Prefer the bundled Rust `mainframe-daemon` binary in a packaged build.
///
/// Tauri's `externalBin` ("binaries/mainframe-daemon") places the matching-triple
/// binary next to the app executable (`mainframe-daemon` once the bundle strips
/// the triple, or `mainframe-daemon-<triple>` in some layouts). Returns `None`
/// when no such binary sits next to the exe, so the caller falls back to the
/// env override / dev monorepo path.
pub fn find_bundled_rust_daemon() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    find_bundled_binary_in(exe.parent()?, "mainframe-daemon")
}

/// Pure directory scan behind [`find_bundled_node`] (unit-testable).
fn find_bundled_node_in(dir: &Path) -> Option<PathBuf> {
    find_bundled_binary_in(dir, "node")
}

/// Locate a bundled sidecar binary named `stem` (or `stem-<triple>`) in `dir`,
/// rejecting zero-byte placeholders. Shared by the Node and Rust finders.
///
/// The exact base name is checked first (Tauri strips the triple in the
/// assembled bundle), then the triple-suffixed siblings that may sit next to a
/// dev binary. The `stem-` prefix keeps the two impls' scans disjoint
/// (`mainframe-daemon-…` never matches the `node` scan and vice-versa).
fn find_bundled_binary_in(dir: &Path, stem: &str) -> Option<PathBuf> {
    let runnable = |p: &Path| -> bool {
        std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.len() >= MIN_SIDECAR_BIN_BYTES)
    };
    for name in [stem.to_string(), format!("{stem}.exe")] {
        let candidate = dir.join(&name);
        if runnable(&candidate) {
            tracing::info!(binary = %candidate.display(), stem, "using bundled sidecar binary");
            return Some(candidate);
        }
    }
    let prefix = format!("{stem}-");
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(&prefix) && runnable(&entry.path()) {
            tracing::info!(binary = %entry.path().display(), stem, "using bundled sidecar binary (triple)");
            return Some(entry.path());
        }
    }
    None
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
        let mut tags = ["v9.11.2", "v10.24.1", "v18.20.0", "v8.17.0"];
        tags.sort_by_key(|a| parse(a));
        assert_eq!(
            tags.last(),
            Some(&"v18.20.0"),
            "expected v18.20.0 to sort last (highest)"
        );
        // Confirm v10 beats v9 under numeric sort.
        assert!(parse("v10.0.0") > parse("v9.11.2"));
    }

    /// find_bundled_node_in prefers a runnable `node`, ignores zero-byte
    /// placeholders, and falls back to a triple-suffixed sibling.
    #[test]
    fn bundled_node_scan() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("mf-bundled-node-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Nothing runnable yet → None.
        assert!(find_bundled_node_in(&dir).is_none());

        // A zero-byte placeholder must be ignored.
        std::fs::File::create(dir.join("node-aarch64-apple-darwin")).unwrap();
        assert!(find_bundled_node_in(&dir).is_none());

        // A real-sized triple binary is found via the fallback.
        let mut f = std::fs::File::create(dir.join("node-x86_64-unknown-linux-gnu")).unwrap();
        f.write_all(&vec![0u8; (MIN_SIDECAR_BIN_BYTES + 1) as usize]).unwrap();
        assert_eq!(
            find_bundled_node_in(&dir),
            Some(dir.join("node-x86_64-unknown-linux-gnu"))
        );

        // The exact base name `node` wins over the triple sibling.
        let mut f = std::fs::File::create(dir.join("node")).unwrap();
        f.write_all(&vec![0u8; (MIN_SIDECAR_BIN_BYTES + 1) as usize]).unwrap();
        assert_eq!(find_bundled_node_in(&dir), Some(dir.join("node")));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The Rust daemon scan finds `mainframe-daemon[-triple]`, ignores zero-byte
    /// placeholders, and stays disjoint from a sibling `node` binary.
    #[test]
    fn bundled_rust_daemon_scan() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("mf-bundled-rustd-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // A sibling `node` must not satisfy the mainframe-daemon scan.
        let mut n = std::fs::File::create(dir.join("node")).unwrap();
        n.write_all(&vec![0u8; (MIN_SIDECAR_BIN_BYTES + 1) as usize]).unwrap();
        assert!(find_bundled_binary_in(&dir, "mainframe-daemon").is_none());

        // Zero-byte placeholder ignored.
        std::fs::File::create(dir.join("mainframe-daemon-aarch64-apple-darwin")).unwrap();
        assert!(find_bundled_binary_in(&dir, "mainframe-daemon").is_none());

        // Real-sized triple binary found via the fallback.
        let mut f =
            std::fs::File::create(dir.join("mainframe-daemon-x86_64-unknown-linux-gnu")).unwrap();
        f.write_all(&vec![0u8; (MIN_SIDECAR_BIN_BYTES + 1) as usize]).unwrap();
        assert_eq!(
            find_bundled_binary_in(&dir, "mainframe-daemon"),
            Some(dir.join("mainframe-daemon-x86_64-unknown-linux-gnu"))
        );

        // Exact base name wins over the triple sibling.
        let mut f = std::fs::File::create(dir.join("mainframe-daemon")).unwrap();
        f.write_all(&vec![0u8; (MIN_SIDECAR_BIN_BYTES + 1) as usize]).unwrap();
        assert_eq!(
            find_bundled_binary_in(&dir, "mainframe-daemon"),
            Some(dir.join("mainframe-daemon"))
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn daemon_env_overrides_remove_shell_owned_data_dir_when_not_explicit() {
        assert!(
            daemon_env_overrides(31500, None).contains(&EnvOverride::Remove("MAINFRAME_DATA_DIR"))
        );
    }

    #[test]
    fn daemon_env_overrides_keep_explicit_data_dir() {
        assert!(
            daemon_env_overrides(31500, Some(Path::new("/tmp/mainframe-data"))).contains(
                &EnvOverride::Set("MAINFRAME_DATA_DIR", "/tmp/mainframe-data".to_string())
            )
        );
    }
}
