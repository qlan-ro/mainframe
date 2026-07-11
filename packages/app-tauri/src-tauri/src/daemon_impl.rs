//! Daemon-implementation canary flag (`MAINFRAME_DAEMON_IMPL`).
//!
//! Selects between the legacy Node sidecar (`node`, the DEFAULT) and the ported
//! Rust `mainframe-daemon` binary (`rust`). Resolution precedence:
//!   1. `MAINFRAME_DAEMON_IMPL` env (`rust` | `node`, case-insensitive).
//!   2. Persisted `<data_dir>/app-settings.json` key `daemonImpl` (so the UI can
//!      flip the canary across restarts, mirroring the `remote-daemons.json`
//!      file store in `commands/daemons.rs`).
//!   3. Default: Node.

use std::path::{Path, PathBuf};

const SETTINGS_FILE: &str = "app-settings.json";
const IMPL_KEY: &str = "daemonImpl";
const IMPL_ENV: &str = "MAINFRAME_DAEMON_IMPL";

/// Which daemon binary the shell should spawn.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DaemonImpl {
    Node,
    Rust,
}

impl DaemonImpl {
    pub fn as_str(self) -> &'static str {
        match self {
            DaemonImpl::Node => "node",
            DaemonImpl::Rust => "rust",
        }
    }

    /// Parse a raw flag value (case-insensitive, trimmed). Unknown → `None`.
    fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "rust" => Some(DaemonImpl::Rust),
            "node" => Some(DaemonImpl::Node),
            _ => None,
        }
    }
}

/// Resolve the effective daemon impl for this launch (env → persisted → default).
pub fn resolve_daemon_impl() -> DaemonImpl {
    resolve_from(std::env::var(IMPL_ENV).ok().as_deref(), &settings_path())
}

/// Pure resolver (unit-testable): env value takes precedence, then the persisted
/// settings file, then the Node default.
fn resolve_from(env_value: Option<&str>, settings: &Path) -> DaemonImpl {
    if let Some(raw) = env_value {
        match DaemonImpl::parse(raw) {
            Some(v) => return v,
            None => tracing::warn!(
                value = %raw,
                "invalid MAINFRAME_DAEMON_IMPL — falling back to persisted setting / node default"
            ),
        }
    }
    read_persisted_impl(settings).unwrap_or(DaemonImpl::Node)
}

/// `<data_dir>/app-settings.json`, resolving the data dir the same way as the
/// daemon (`MAINFRAME_DATA_DIR` or `~/.mainframe`).
fn settings_path() -> PathBuf {
    let dir = std::env::var("MAINFRAME_DATA_DIR")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("/tmp"))
                .join(".mainframe")
        });
    dir.join(SETTINGS_FILE)
}

/// Read the persisted `daemonImpl` value. A missing file is the expected initial
/// state (not logged); malformed JSON is warned and treated as unset.
fn read_persisted_impl(path: &Path) -> Option<DaemonImpl> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            tracing::warn!(path = %path.display(), err = %e, "app-settings.json unreadable");
            return None;
        }
    };
    let value: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(path = %path.display(), err = %e, "app-settings.json parse failed");
            return None;
        }
    };
    value
        .get(IMPL_KEY)
        .and_then(|v| v.as_str())
        .and_then(DaemonImpl::parse)
}

/// Persist the `daemonImpl` value, preserving any other keys already in the file.
fn write_persisted_impl(path: &Path, value: DaemonImpl) -> Result<(), String> {
    let mut obj = match std::fs::read_to_string(path) {
        Ok(c) => serde_json::from_str::<serde_json::Value>(&c)
            .ok()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default(),
        Err(_) => serde_json::Map::new(),
    };
    obj.insert(
        IMPL_KEY.to_string(),
        serde_json::Value::String(value.as_str().to_string()),
    );
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create_dir_all {}: {e}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(&serde_json::Value::Object(obj))
        .map_err(|e| format!("serialize app-settings: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("write {}: {e}", path.display()))
}

// ── Tauri commands (let the renderer read/flip the canary) ───────────────────

/// Returns the effective daemon impl (`"node"` | `"rust"`).
#[tauri::command]
pub fn daemon_impl_get() -> String {
    resolve_daemon_impl().as_str().to_string()
}

/// Persists the daemon-impl canary. Takes effect on the next app launch (the
/// daemon is spawned once at boot). Rejects any value other than node/rust.
#[tauri::command]
pub fn daemon_impl_set(value: String) -> Result<(), String> {
    let parsed =
        DaemonImpl::parse(&value).ok_or_else(|| format!("invalid daemon impl: {value}"))?;
    write_persisted_impl(&settings_path(), parsed)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "mf-daemon-impl-{}-{}.json",
            std::process::id(),
            tag
        ))
    }

    #[test]
    fn parse_is_case_insensitive_and_trimmed() {
        assert_eq!(DaemonImpl::parse("  RUST "), Some(DaemonImpl::Rust));
        assert_eq!(DaemonImpl::parse("Node"), Some(DaemonImpl::Node));
        assert_eq!(DaemonImpl::parse("go"), None);
    }

    #[test]
    fn env_wins_over_persisted() {
        let path = tmp("env-wins");
        write_persisted_impl(&path, DaemonImpl::Rust).unwrap();
        // env says node → node, despite persisted rust.
        assert_eq!(resolve_from(Some("node"), &path), DaemonImpl::Node);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn invalid_env_falls_back_to_persisted() {
        let path = tmp("invalid-env");
        write_persisted_impl(&path, DaemonImpl::Rust).unwrap();
        assert_eq!(resolve_from(Some("banana"), &path), DaemonImpl::Rust);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn defaults_to_node_when_unset() {
        let path = tmp("missing");
        std::fs::remove_file(&path).ok();
        assert_eq!(resolve_from(None, &path), DaemonImpl::Node);
    }

    #[test]
    fn persisted_rust_used_when_env_unset() {
        let path = tmp("persisted-rust");
        write_persisted_impl(&path, DaemonImpl::Rust).unwrap();
        assert_eq!(resolve_from(None, &path), DaemonImpl::Rust);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn write_preserves_unrelated_keys() {
        let path = tmp("preserve");
        std::fs::write(&path, r#"{"theme":"dark","daemonImpl":"node"}"#).unwrap();
        write_persisted_impl(&path, DaemonImpl::Rust).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("\"theme\""), "unrelated key dropped: {raw}");
        assert_eq!(read_persisted_impl(&path), Some(DaemonImpl::Rust));
        std::fs::remove_file(&path).ok();
    }
}
