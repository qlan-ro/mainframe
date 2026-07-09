/// Daemon registry + keyring token commands.
///
/// Persists non-secret daemon metadata in `<data_dir>/remote-daemons.json`
/// and stores per-daemon auth tokens exclusively in the OS keyring under the
/// service `ro.qlan.mainframe.daemon` (account = daemon id). Tokens NEVER
/// appear in the registry file.

use std::path::{Path, PathBuf};

const KEYRING_SERVICE: &str = "ro.qlan.mainframe.daemon";

// ── Data types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DaemonMeta {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub host: String,
    pub device: Option<String>,
    pub paired: Option<String>,
}

// ── Path resolution ───────────────────────────────────────────────────────────

/// Resolves the registry file path.
///
/// Precedence (mirrors `auth.rs::resolve_config_path`):
///   1. `data_dir` argument
///   2. `MAINFRAME_DATA_DIR` env var
///   3. `~/.mainframe` (with `/tmp` fallback when `$HOME` is absent)
pub fn resolve_registry_path(data_dir: Option<String>) -> PathBuf {
    let dir = data_dir
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var("MAINFRAME_DATA_DIR")
                .ok()
                .map(PathBuf::from)
        })
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("/tmp"))
                .join(".mainframe")
        });
    dir.join("remote-daemons.json")
}

// ── File I/O ──────────────────────────────────────────────────────────────────

/// Reads the registry file. Returns `vec![]` on any I/O or parse error (the
/// file simply not existing is the expected initial state, so that is not
/// logged as a warning — only malformed content is).
pub fn read_registry(path: &Path) -> Vec<DaemonMeta> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return vec![];
        }
        Err(e) => {
            tracing::warn!(path = %path.display(), err = %e, "remote-daemons.json unreadable");
            return vec![];
        }
    };

    match serde_json::from_str::<Vec<DaemonMeta>>(&content) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(path = %path.display(), err = %e, "remote-daemons.json parse failed");
            vec![]
        }
    }
}

/// Writes the registry file, creating the parent directory if needed.
pub fn write_registry(path: &Path, metas: &[DaemonMeta]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create_dir_all {}: {e}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(metas)
        .map_err(|e| format!("serialize daemons: {e}"))?;
    std::fs::write(path, json)
        .map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Returns the full list of registered daemons (no tokens).
#[tauri::command]
pub fn daemons_list(data_dir: Option<String>) -> Vec<DaemonMeta> {
    let path = resolve_registry_path(data_dir);
    read_registry(&path)
}

/// Inserts or replaces a daemon entry (matched by `meta.id`).
#[tauri::command]
pub fn daemons_upsert(data_dir: Option<String>, meta: DaemonMeta) {
    let path = resolve_registry_path(data_dir);
    let mut list = read_registry(&path);
    if let Some(existing) = list.iter_mut().find(|d| d.id == meta.id) {
        *existing = meta;
    } else {
        list.push(meta);
    }
    if let Err(e) = write_registry(&path, &list) {
        tracing::warn!(err = %e, "daemons_upsert: write failed");
    }
}

/// Removes a daemon entry and deletes its keyring token.
#[tauri::command]
pub fn daemons_remove(data_dir: Option<String>, id: String) {
    let path = resolve_registry_path(data_dir);
    let mut list = read_registry(&path);
    list.retain(|d| d.id != id);
    if let Err(e) = write_registry(&path, &list) {
        tracing::warn!(err = %e, "daemons_remove: write failed");
    }
    // Best-effort keyring delete — log but do not propagate.
    match keyring::Entry::new(KEYRING_SERVICE, &id) {
        Ok(entry) => {
            if let Err(e) = entry.delete_credential() {
                tracing::debug!(id = %id, err = %e, "daemons_remove: keyring delete skipped (may not exist)");
            }
        }
        Err(e) => {
            tracing::warn!(id = %id, err = %e, "daemons_remove: failed to open keyring entry");
        }
    }
}

/// Returns the keyring token for a daemon, or `None` if absent or unavailable.
///
/// Deliberately lenient (unlike `daemon_token_set`): a read failure logs and
/// returns `None` rather than propagating, so a transient keyring hiccup on
/// boot/daemon-switch degrades to a token-less connect (surfaced by the WS
/// auth reject) instead of hard-blocking the app. The loud path is on write,
/// where a failure means pairing did not actually persist and must not be
/// reported as success.
#[tauri::command]
pub fn daemon_token_get(id: String) -> Option<String> {
    match keyring::Entry::new(KEYRING_SERVICE, &id) {
        Ok(entry) => match entry.get_password() {
            Ok(token) => Some(token),
            Err(keyring::Error::NoEntry) => None,
            Err(e) => {
                tracing::error!(id = %id, err = %e, "daemon_token_get: keyring read failed");
                None
            }
        },
        Err(e) => {
            tracing::error!(id = %id, err = %e, "daemon_token_get: failed to open keyring entry");
            None
        }
    }
}

/// Stores a token for a daemon in the OS keyring.
///
/// Returns `Err` on failure so the caller (pairing) fails loudly instead of
/// reporting a paired-but-tokenless state that silently breaks the WebSocket.
#[tauri::command]
pub fn daemon_token_set(id: String, token: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &id)
        .map_err(|e| format!("open keyring entry: {e}"))?;
    entry
        .set_password(&token)
        .map_err(|e| format!("write token to keyring: {e}"))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_roundtrips_through_the_file() {
        let dir = std::env::temp_dir().join(format!("mf-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("remote-daemons.json");
        let metas = vec![DaemonMeta {
            id: "studio".into(),
            kind: "remote".into(),
            label: "Studio".into(),
            host: "studio.example.com".into(),
            device: None,
            paired: None,
        }];
        write_registry(&p, &metas).unwrap();
        let back = read_registry(&p);
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].id, "studio");
    }

    #[test]
    fn registry_contains_no_token_field() {
        let dir = std::env::temp_dir().join(format!(
            "mf-test-notoken-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("remote-daemons.json");
        let metas = vec![DaemonMeta {
            id: "vault".into(),
            kind: "remote".into(),
            label: "Vault".into(),
            host: "vault.example.com".into(),
            device: None,
            paired: None,
        }];
        write_registry(&p, &metas).unwrap();
        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(
            !raw.contains("token"),
            "registry JSON must not contain any 'token' field; got: {raw}"
        );
    }

    #[test]
    fn read_registry_returns_empty_on_missing_file() {
        let p = std::env::temp_dir().join(format!(
            "mf-test-missing-{}.json",
            std::process::id()
        ));
        // Ensure the file definitely doesn't exist.
        let _ = std::fs::remove_file(&p);
        let back = read_registry(&p);
        assert!(back.is_empty());
    }

    #[test]
    fn resolve_registry_path_uses_suffix() {
        let p = resolve_registry_path(Some("/tmp/mf-data".into()));
        assert!(
            p.to_str().unwrap().ends_with("remote-daemons.json"),
            "expected path ending in remote-daemons.json, got: {}",
            p.display()
        );
    }

    #[test]
    fn upsert_replaces_existing_entry() {
        // Use a unique subdirectory so this test is isolated from others.
        let dir = std::env::temp_dir().join(format!(
            "mf-test-upsert-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let data_dir = dir.to_str().unwrap().to_string();

        let v1 = DaemonMeta {
            id: "alpha".into(),
            kind: "remote".into(),
            label: "Old Label".into(),
            host: "old.example.com".into(),
            device: None,
            paired: None,
        };
        // First upsert: inserts a new entry.
        daemons_upsert(Some(data_dir.clone()), v1);

        let v2 = DaemonMeta {
            id: "alpha".into(),
            kind: "remote".into(),
            label: "New Label".into(),
            host: "new.example.com".into(),
            device: None,
            paired: None,
        };
        // Second upsert: same id → must replace, not append.
        daemons_upsert(Some(data_dir.clone()), v2);

        let list = daemons_list(Some(data_dir));
        assert_eq!(list.len(), 1, "upsert must replace, not append");
        assert_eq!(list[0].id, "alpha");
        assert_eq!(list[0].label, "New Label");
        assert_eq!(list[0].host, "new.example.com");
    }
}
