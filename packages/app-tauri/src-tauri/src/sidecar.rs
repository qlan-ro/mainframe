/// Rust daemon sidecar supervision.
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

/// A real sidecar binary (the Rust `mainframe-daemon`) is several MB; this
/// floor rejects the zero-byte `binaries/mainframe-daemon-<triple>` scaffold
/// placeholders that may sit next to the exe in a dev build (spawning a
/// zero-byte file would fail at runtime).
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

/// The daemon program to spawn: the Rust `mainframe-daemon` binary, run directly.
pub struct DaemonProgram {
    /// Absolute path to the `mainframe-daemon` executable.
    pub daemon_bin: PathBuf,
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

/// Spawn the daemon sidecar. Returns a handle used to kill it on app exit.
///
/// Environment precedence (matching Electron's `startDaemon`):
///   base process env  ←  shell_env overlay  ←  app-owned daemon overrides
pub fn spawn_daemon(config: SidecarConfig) -> Result<DaemonHandle, String> {
    let mut cmd = Command::new(&config.program.daemon_bin);

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

    tracing::info!(
        program = %config.program.daemon_bin.display(),
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

/// Locate a bundled sidecar binary named `stem` (or `stem-<triple>`) in `dir`,
/// rejecting zero-byte placeholders.
///
/// The exact base name is checked first (Tauri strips the triple in the
/// assembled bundle), then the triple-suffixed siblings that may sit next to a
/// dev binary.
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

#[cfg(test)]
mod tests {
    use super::*;

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
