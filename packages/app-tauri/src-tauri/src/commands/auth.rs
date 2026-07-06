/// Auth token commands.
///
/// Reads the daemon auth secret from `~/.mainframe/config.json` (the same
/// location the daemon writes it via `ensureAuthSecret()` in config.ts).
/// The renderer uses this to authenticate WebSocket connections.
use std::path::PathBuf;

/// Returns the daemon auth secret from the data directory config.
///
/// Returns `None` when:
/// - The config file does not exist yet (daemon not started).
/// - The `authSecret` field is absent (daemon runs without auth).
/// - The file is unreadable or invalid JSON.
#[tauri::command]
pub fn get_auth_token(data_dir: Option<String>) -> Option<String> {
    let config_path = resolve_config_path(data_dir);
    read_auth_secret(&config_path)
}

fn resolve_config_path(data_dir: Option<String>) -> PathBuf {
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
    dir.join("config.json")
}

fn read_auth_secret(config_path: &PathBuf) -> Option<String> {
    let content = std::fs::read_to_string(config_path)
        .map_err(|e| {
            tracing::debug!(path = %config_path.display(), err = %e, "config.json not readable");
        })
        .ok()?;

    let value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| {
            tracing::warn!(path = %config_path.display(), err = %e, "config.json parse failed");
        })
        .ok()?;

    value
        .get("authSecret")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}
