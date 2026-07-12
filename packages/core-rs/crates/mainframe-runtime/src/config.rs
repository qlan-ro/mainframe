//! Ported from `src/config.ts`.
//!
//! `config.json` load/merge/persist under `$MAINFRAME_DATA_DIR` (default
//! `~/.mainframe`), env overrides, and the 32-byte random-hex auth secret.
//!
//! Deviations from the TS source (see PORT STATUS):
//! - `port` is `u16` (the whole daemon binds a `u16`); TS `Number(rawPort)`
//!   accepts non-integer / `> 65535` values into `config.port`. Ports outside
//!   `1..=65535` are rejected here rather than stored, matching how the daemon
//!   would ultimately fail to bind them.
//! - Reading `process.env` is safe in Rust (only `set_var` is `unsafe` under
//!   edition 2024), so the env reads are ported verbatim. `ensureAuthSecret`
//!   never mutated env in the TS source — it persists to `config.json` — so no
//!   env-state threading is required.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Errors that mirror the TS `throw` paths (`getDataDir`/`saveConfig` throw on
/// I/O failure; `getConfig` swallows parse errors and falls back to defaults).
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("config I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("config serialize error: {0}")]
    Serialize(#[from] serde_json::Error),
}

/// Mirrors `MainframeConfig` in `src/config.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MainframeConfig {
    pub port: u16,
    pub data_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tunnel: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tunnel_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tunnel_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_secret: Option<String>,
}

/// `Partial<MainframeConfig>` — a `config.json` file (or env overrides) may carry
/// any subset of the fields. Unknown fields are tolerated, matching the TS
/// `JSON.parse` + spread merge (never `.strict()`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartialMainframeConfig {
    pub port: Option<u16>,
    pub data_dir: Option<String>,
    pub tunnel: Option<bool>,
    pub tunnel_url: Option<String>,
    pub tunnel_token: Option<String>,
    pub auth_secret: Option<String>,
}

/// Default daemon HTTP/WS port, matching `DEFAULT_CONFIG.port` in `src/config.ts`.
pub const DEFAULT_PORT: u16 = 31415;

/// `join(homedir(), '.mainframe')` — the `DEFAULT_CONFIG.dataDir` value.
fn default_data_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".mainframe")
}

/// `DEFAULT_CONFIG` in `src/config.ts`.
fn default_config() -> MainframeConfig {
    MainframeConfig {
        port: DEFAULT_PORT,
        data_dir: default_data_dir().to_string_lossy().into_owned(),
        tunnel: None,
        tunnel_url: None,
        tunnel_token: None,
        auth_secret: None,
    }
}

/// Parses `DAEMON_PORT` the way `Number(rawPort)` + `Number.isFinite && > 0`
/// does: only a positive, in-range integer overrides the default.
fn env_port_override(raw: &str) -> Option<u16> {
    raw.trim().parse::<u16>().ok().filter(|port| *port > 0)
}

/// Mirrors `envOverrides()` in `src/config.ts`. Reads the process environment;
/// env vars always win over `config.json`.
fn env_overrides() -> PartialMainframeConfig {
    let mut overrides = PartialMainframeConfig::default();

    if let Ok(raw_port) = std::env::var("DAEMON_PORT")
        && let Some(port) = env_port_override(&raw_port)
    {
        overrides.port = Some(port);
    }
    if let Ok(dir) = std::env::var("MAINFRAME_DATA_DIR")
        && !dir.is_empty()
    {
        overrides.data_dir = Some(dir);
    }
    if std::env::var("TUNNEL").as_deref() == Ok("true") {
        overrides.tunnel = Some(true);
    }
    if let Ok(url) = std::env::var("TUNNEL_URL")
        && !url.is_empty()
    {
        overrides.tunnel_url = Some(url);
    }
    if let Ok(token) = std::env::var("TUNNEL_TOKEN")
        && !token.is_empty()
    {
        overrides.tunnel_token = Some(token);
    }

    overrides
}

/// `{ ...DEFAULT_CONFIG, ...fileConfig, ...envOverrides() }` — later sources
/// override earlier ones, field by field.
fn merge_config(file: PartialMainframeConfig, env: PartialMainframeConfig) -> MainframeConfig {
    let mut config = default_config();
    for partial in [file, env] {
        if let Some(port) = partial.port {
            config.port = port;
        }
        if let Some(data_dir) = partial.data_dir {
            config.data_dir = data_dir;
        }
        if let Some(tunnel) = partial.tunnel {
            config.tunnel = Some(tunnel);
        }
        if let Some(tunnel_url) = partial.tunnel_url {
            config.tunnel_url = Some(tunnel_url);
        }
        if let Some(tunnel_token) = partial.tunnel_token {
            config.tunnel_token = Some(tunnel_token);
        }
        if let Some(auth_secret) = partial.auth_secret {
            config.auth_secret = Some(auth_secret);
        }
    }
    config
}

/// Reads and parses `<dir>/config.json`. On any read/parse error, returns an
/// empty partial — mirroring the TS `try { JSON.parse } catch { /* defaults */ }`.
fn read_file_config(dir: &Path) -> PartialMainframeConfig {
    let config_path = dir.join("config.json");
    match fs::read_to_string(&config_path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => PartialMainframeConfig::default(),
    }
}

/// Mirrors `getDataDir()`: `$MAINFRAME_DATA_DIR` or `~/.mainframe`, created
/// recursively if absent.
pub fn get_data_dir() -> Result<PathBuf, ConfigError> {
    let dir = std::env::var("MAINFRAME_DATA_DIR")
        .ok()
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_data_dir);
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}

/// Mirrors `getConfig()`: `{ ...DEFAULT, ...config.json, ...env }`.
pub fn get_config() -> Result<MainframeConfig, ConfigError> {
    let dir = get_data_dir()?;
    Ok(merge_config(read_file_config(&dir), env_overrides()))
}

/// Mirrors `saveConfig(config)`: merges the partial onto the current config and
/// writes `config.json` pretty-printed with two-space indent.
pub fn save_config(config: PartialMainframeConfig) -> Result<(), ConfigError> {
    let dir = get_data_dir()?;
    let current = merge_config(read_file_config(&dir), env_overrides());
    save_config_in(&dir, current, config)
}

/// The `saveConfig` write path, factored to accept an explicit dir + current
/// config so it is testable without mutating process env.
fn save_config_in(
    dir: &Path,
    current: MainframeConfig,
    overrides: PartialMainframeConfig,
) -> Result<(), ConfigError> {
    let merged = merge_config(
        PartialMainframeConfig {
            port: Some(current.port),
            data_dir: Some(current.data_dir),
            tunnel: current.tunnel,
            tunnel_url: current.tunnel_url,
            tunnel_token: current.tunnel_token,
            auth_secret: current.auth_secret,
        },
        overrides,
    );
    let json = serde_json::to_string_pretty(&merged)?;
    fs::write(dir.join("config.json"), json)?;
    Ok(())
}

/// Mirrors `getAuthSecret()`: `AUTH_TOKEN_SECRET` env, else `config.authSecret`.
fn get_auth_secret() -> Result<Option<String>, ConfigError> {
    if let Ok(secret) = std::env::var("AUTH_TOKEN_SECRET")
        && !secret.is_empty()
    {
        return Ok(Some(secret));
    }
    Ok(get_config()?.auth_secret)
}

/// `randomBytes(32).toString('hex')` — 32 random bytes as 64 lowercase hex chars.
fn generate_auth_secret() -> String {
    let bytes: [u8; 32] = rand::random();
    hex::encode(bytes)
}

/// Mirrors `ensureAuthSecret()`: returns the existing secret, or mints a new
/// 32-byte hex secret, persists it via `saveConfig`, and returns it.
pub fn ensure_auth_secret() -> Result<String, ConfigError> {
    if let Some(existing) = get_auth_secret()? {
        return Ok(existing);
    }
    let secret = generate_auth_secret();
    save_config(PartialMainframeConfig {
        auth_secret: Some(secret.clone()),
        ..PartialMainframeConfig::default()
    })?;
    Ok(secret)
}

/// Mirrors the `DAEMON_PORT` branch of `envOverrides()`: only a finite, positive
/// value overrides the default.
///
/// Pure by construction (takes the raw env value as an argument) so it's testable
/// without `std::env::set_var`, which edition 2024 makes `unsafe`.
pub fn resolve_port_from(raw: Option<&str>) -> u16 {
    match raw {
        Some(raw) => env_port_override(raw).unwrap_or(DEFAULT_PORT),
        None => DEFAULT_PORT,
    }
}

/// Reads `DAEMON_PORT` from the process environment and resolves it via
/// [`resolve_port_from`].
pub fn resolve_port() -> u16 {
    resolve_port_from(std::env::var("DAEMON_PORT").ok().as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resolve_port_defaults_when_unset() {
        assert_eq!(resolve_port_from(None), DEFAULT_PORT);
    }

    #[test]
    fn resolve_port_honors_valid_override() {
        assert_eq!(resolve_port_from(Some("31500")), 31500);
    }

    #[test]
    fn resolve_port_falls_back_on_invalid_value() {
        assert_eq!(resolve_port_from(Some("not-a-port")), DEFAULT_PORT);
    }

    #[test]
    fn resolve_port_falls_back_on_zero() {
        assert_eq!(resolve_port_from(Some("0")), DEFAULT_PORT);
    }

    #[test]
    fn merge_applies_default_file_then_env() {
        let file = PartialMainframeConfig {
            port: Some(40000),
            auth_secret: Some("from-file".into()),
            ..Default::default()
        };
        let env = PartialMainframeConfig {
            port: Some(41000),
            ..Default::default()
        };
        let merged = merge_config(file, env);
        // env wins over file for port; file-only fields survive.
        assert_eq!(merged.port, 41000);
        assert_eq!(merged.auth_secret.as_deref(), Some("from-file"));
        assert!(merged.data_dir.ends_with(".mainframe"));
    }

    #[test]
    fn read_file_config_tolerates_missing_and_malformed() {
        let dir = tempdir().unwrap();
        // missing file -> empty partial
        assert!(read_file_config(dir.path()).auth_secret.is_none());
        // malformed json -> empty partial (no propagation)
        fs::write(dir.path().join("config.json"), "{not json").unwrap();
        assert!(read_file_config(dir.path()).port.is_none());
    }

    #[test]
    fn read_file_config_parses_camelcase_fields() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("config.json"),
            r#"{"port":31500,"dataDir":"/tmp/mf","authSecret":"abc","tunnelUrl":"https://x"}"#,
        )
        .unwrap();
        let parsed = read_file_config(dir.path());
        assert_eq!(parsed.port, Some(31500));
        assert_eq!(parsed.data_dir.as_deref(), Some("/tmp/mf"));
        assert_eq!(parsed.auth_secret.as_deref(), Some("abc"));
        assert_eq!(parsed.tunnel_url.as_deref(), Some("https://x"));
    }

    #[test]
    fn save_config_in_round_trips_auth_secret() {
        let dir = tempdir().unwrap();
        let current = default_config();
        save_config_in(
            dir.path(),
            current,
            PartialMainframeConfig {
                auth_secret: Some("deadbeef".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let reloaded = read_file_config(dir.path());
        assert_eq!(reloaded.auth_secret.as_deref(), Some("deadbeef"));
        assert_eq!(reloaded.port, Some(DEFAULT_PORT));
    }

    #[test]
    fn save_config_pretty_prints_two_space_indent() {
        let dir = tempdir().unwrap();
        save_config_in(
            dir.path(),
            default_config(),
            PartialMainframeConfig::default(),
        )
        .unwrap();
        let written = fs::read_to_string(dir.path().join("config.json")).unwrap();
        assert!(
            written.contains("\n  \"port\""),
            "two-space indent: {written}"
        );
        // Optional fields (None) are omitted, matching JSON.stringify.
        assert!(!written.contains("authSecret"));
    }

    #[test]
    fn generate_auth_secret_is_64_hex_chars() {
        let secret = generate_auth_secret();
        assert_eq!(secret.len(), 64);
        assert!(secret.chars().all(|c| c.is_ascii_hexdigit()));
        // Randomness: two calls differ with overwhelming probability.
        assert_ne!(secret, generate_auth_secret());
    }
}

// PORT STATUS: src/config.ts (86 lines)
// confidence: high
// todos: 0
// notes: full port — config.json load/merge/persist, env overrides, and the
// 32-byte hex auth secret. `resolve_port`/`resolve_port_from` are scaffold
// conveniences (no TS counterpart) kept because mainframe-daemon::main consumes
// them; they overlap `get_config().port`. Deviations documented at module top:
// `port` is `u16` (rejects out-of-range instead of storing); env reads are ported
// verbatim (safe in Rust); `ensureAuthSecret` persists to config.json and never
// mutates env, so no env-state threading is needed. save/merge are exercised
// with tempfile dirs (no `set_var`); the env-reading `get_config`/`save_config`/
// `ensure_auth_secret` wrappers are thin shells over the tested pure functions.
