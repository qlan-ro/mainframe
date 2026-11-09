//! `config.json` load/merge/persist under `$MAINFRAME_DATA_DIR` (default
//! `~/.mainframe`), env overrides, and the 32-byte random-hex auth secret.
//!
//! The file holds the auth secret and tunnel token, so it is only ever written
//! atomically and owner-only. A save edits the file's own keys: env overrides
//! and defaults stay out of it, and keys this version does not know survive.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

mod persist;

use persist::restrict_config_file;
pub use persist::{clear_tunnel_credentials, save_config};

const CONFIG_FILE: &str = "config.json";

/// A malformed `config.json` is not an error: `get_config` logs it and falls
/// back to defaults.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("config I/O error: {0}")]
    Io(#[from] io::Error),
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

/// Any subset of [`MainframeConfig`], from `config.json`, env overrides, or a
/// save. Unknown fields are tolerated. A file with a field of the wrong type,
/// such as an out-of-range `port`, does not parse.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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

/// The `config.json` overlay in `dir`; a missing, unreadable, or malformed file
/// contributes nothing.
fn read_file_config(dir: &Path) -> PartialMainframeConfig {
    let path = dir.join(CONFIG_FILE);
    let content = match fs::read(&path) {
        Ok(content) => content,
        Err(error) => {
            if error.kind() != io::ErrorKind::NotFound {
                tracing::warn!(%error, path = %path.display(), "config file unreadable, using defaults");
            }
            return PartialMainframeConfig::default();
        }
    };
    serde_json::from_slice(&content).unwrap_or_else(|error| {
        tracing::warn!(%error, path = %path.display(), "config file malformed, using defaults");
        PartialMainframeConfig::default()
    })
}

/// Returns `$MAINFRAME_DATA_DIR` or `~/.mainframe`, created recursively if
/// absent.
pub fn get_data_dir() -> Result<PathBuf, ConfigError> {
    let dir = std::env::var("MAINFRAME_DATA_DIR")
        .ok()
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_data_dir);
    fs::create_dir_all(&dir)?;
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

/// The auth secret: `AUTH_TOKEN_SECRET` env, else `config.authSecret`.
fn get_auth_secret() -> Result<Option<String>, ConfigError> {
    let env = std::env::var("AUTH_TOKEN_SECRET").ok();
    Ok(pick_auth_secret(env, get_config()?.auth_secret))
}

/// An empty value counts as unset: HMAC accepts an empty key, and anyone could
/// then forge a device token.
fn pick_auth_secret(env: Option<String>, configured: Option<String>) -> Option<String> {
    let usable = |secret: &String| !secret.is_empty();
    env.filter(usable).or(configured.filter(usable))
}

/// 32 random bytes as 64 lowercase hex chars.
fn generate_auth_secret() -> String {
    let bytes: [u8; 32] = rand::random();
    hex::encode(bytes)
}

/// Returns the existing secret, or mints a new 32-byte hex secret, persists it
/// via `save_config`, and returns it.
pub fn ensure_auth_secret() -> Result<String, ConfigError> {
    restrict_config_file(&get_data_dir()?);
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
