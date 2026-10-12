//! `config.json` load/merge/persist under `$MAINFRAME_DATA_DIR` (default
//! `~/.mainframe`), env overrides, and the 32-byte random-hex auth secret.
//!
//! - `port` is `u16` (the whole daemon binds a `u16`). Ports outside
//!   `1..=65535` are rejected here rather than stored, matching how the daemon
//!   would ultimately fail to bind them.
//! - Reading the process env is safe in Rust (only `set_var` is `unsafe` under
//!   edition 2024). `ensure_auth_secret` never mutates env — it persists to
//!   `config.json` — so no env-state threading is required.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Config errors: `get_data_dir`/`save_config` fail on I/O errors, while a
/// malformed `config.json` is not an error (`get_config` falls back to defaults).
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("config I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("config serialize error: {0}")]
    Serialize(#[from] serde_json::Error),
}

/// The merged daemon configuration, persisted as `config.json`.
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
/// any subset of the fields. Unknown fields are tolerated (no
/// `deny_unknown_fields`).
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

/// Default daemon HTTP/WS port.
pub const DEFAULT_PORT: u16 = 31415;

/// `~/.mainframe` — the default data directory.
fn default_data_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".mainframe")
}

/// The built-in defaults that `config.json` and env overrides apply on top of.
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

/// Parses a `DAEMON_PORT` value: only a positive, in-range integer overrides the
/// default.
fn env_port_override(raw: &str) -> Option<u16> {
    raw.trim().parse::<u16>().ok().filter(|port| *port > 0)
}

/// Reads the config overrides from the process environment;
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

/// Defaults, then the file config, then env overrides — later sources
/// override earlier ones, field by field.
fn merge_config(file: PartialMainframeConfig, env: PartialMainframeConfig) -> MainframeConfig {
    let mut config = default_config();
    for partial in [file, env] {
        if let Some(port) = partial.port {
            config.port = port;
        }
        // A blank `dataDir` would become a relative path; treat it as unset,
        // like an empty `$MAINFRAME_DATA_DIR`.
        if let Some(data_dir) = partial.data_dir.filter(|dir| !dir.trim().is_empty()) {
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
/// empty partial, so a missing or malformed file yields the defaults.
fn read_file_config(dir: &Path) -> PartialMainframeConfig {
    let config_path = dir.join("config.json");
    match fs::read_to_string(&config_path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => PartialMainframeConfig::default(),
    }
}

/// Returns `$MAINFRAME_DATA_DIR` or `~/.mainframe`, created recursively if
/// absent.
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

/// Loads the merged config: defaults, then `config.json`, then env overrides.
pub fn get_config() -> Result<MainframeConfig, ConfigError> {
    let dir = get_data_dir()?;
    Ok(merge_config(read_file_config(&dir), env_overrides()))
}

/// The files one daemon boot reads and writes, resolved from the merged config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootPaths {
    /// The merged `dataDir`: everything the daemon stores lives under it.
    pub data_dir: PathBuf,
    /// `<dataDir>/mainframe.db`.
    pub db_path: PathBuf,
    /// `<config dir>/mainframe.db`: where releases that ignored `dataDir` kept
    /// the database, so it can be moved to `db_path`.
    pub legacy_db_path: PathBuf,
    /// `<dataDir>/logs`, home of the daily `server.<date>.log` files.
    pub log_dir: PathBuf,
}

/// Resolves [`BootPaths`] from the merged config and the directory its
/// `config.json` was read from ([`get_data_dir`]).
pub fn boot_paths(config: &MainframeConfig, config_dir: &Path) -> BootPaths {
    let data_dir = PathBuf::from(&config.data_dir);
    BootPaths {
        db_path: data_dir.join("mainframe.db"),
        legacy_db_path: config_dir.join("mainframe.db"),
        log_dir: data_dir.join("logs"),
        data_dir,
    }
}

/// Merges the partial onto the current config and
/// writes `config.json` pretty-printed with two-space indent.
pub fn save_config(config: PartialMainframeConfig) -> Result<(), ConfigError> {
    let dir = get_data_dir()?;
    let current = merge_config(read_file_config(&dir), env_overrides());
    save_config_in(&dir, current, config)
}

/// The `save_config` write path, factored to accept an explicit dir + current
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

/// The auth secret: `AUTH_TOKEN_SECRET` env, else `config.authSecret`.
fn get_auth_secret() -> Result<Option<String>, ConfigError> {
    if let Ok(secret) = std::env::var("AUTH_TOKEN_SECRET")
        && !secret.is_empty()
    {
        return Ok(Some(secret));
    }
    Ok(get_config()?.auth_secret)
}

/// 32 random bytes as 64 lowercase hex chars.
fn generate_auth_secret() -> String {
    let bytes: [u8; 32] = rand::random();
    hex::encode(bytes)
}

/// Returns the existing secret, or mints a new 32-byte hex secret, persists it
/// via `save_config`, and returns it.
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

#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
