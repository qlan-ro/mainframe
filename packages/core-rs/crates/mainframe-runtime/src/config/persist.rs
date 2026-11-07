//! Writes to `config.json`. See the [parent module](super) for the rules.

use super::{CONFIG_FILE, ConfigError, PartialMainframeConfig, get_data_dir};
use mainframe_types::{sync::LockExt, time::now_ms};
use serde_json::{Map, Value};
use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Mutex;

/// Keeps concurrent saves in this process from losing each other's changes.
static CONFIG_WRITES: Mutex<()> = Mutex::new(());

/// Writes the set fields of `changes` into `config.json`.
pub fn save_config(changes: PartialMainframeConfig) -> Result<(), ConfigError> {
    save_config_in(&get_data_dir()?, changes)
}

/// [`save_config`] with an explicit dir, testable without mutating process env.
pub(super) fn save_config_in(
    dir: &Path,
    changes: PartialMainframeConfig,
) -> Result<(), ConfigError> {
    let changes: Map<String, Value> = serde_json::from_value(serde_json::to_value(changes)?)?;
    update_file(dir, |file| {
        file.extend(changes.into_iter().filter(|(_, value)| !value.is_null()));
    })
}

/// Removes the persisted tunnel token and URL. Env overrides still apply.
pub fn clear_tunnel_credentials() -> Result<(), ConfigError> {
    clear_tunnel_credentials_in(&get_data_dir()?)
}

pub(super) fn clear_tunnel_credentials_in(dir: &Path) -> Result<(), ConfigError> {
    update_file(dir, |file| {
        file.remove("tunnelToken");
        file.remove("tunnelUrl");
    })
}

pub(super) fn update_file(
    dir: &Path,
    change: impl FnOnce(&mut Map<String, Value>),
) -> Result<(), ConfigError> {
    let _writes = CONFIG_WRITES.lock_recover();
    let path = dir.join(CONFIG_FILE);
    let mut file = read_editable(&path)?;
    change(&mut file);
    let json = serde_json::to_string_pretty(&file)?;
    crate::fs::write_atomic_blocking(&path, json.as_bytes(), true, || {})
        .map_err(|error| error.source)?;
    Ok(())
}

/// The keys of `config.json` as stored. A file `get_config` cannot use is moved
/// aside, because it may hold the only copy of the auth secret. The name is
/// unique so one bad file cannot replace an earlier one.
fn read_editable(path: &Path) -> Result<Map<String, Value>, ConfigError> {
    let content = match fs::read(path) {
        Ok(content) => content,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(error) => return Err(error.into()),
    };
    match parse_editable(&content) {
        Ok(file) => Ok(file),
        Err(error) => {
            let aside = path.with_extension(format!("json.invalid.{}", now_ms()));
            fs::rename(path, &aside)?;
            tracing::warn!(%error, path = %aside.display(), "config file malformed, moved aside");
            Ok(Map::new())
        }
    }
}

fn parse_editable(content: &[u8]) -> serde_json::Result<Map<String, Value>> {
    serde_json::from_slice::<PartialMainframeConfig>(content)?;
    serde_json::from_slice(content)
}

/// Restricts a `config.json` left readable by other local users. Earlier
/// releases wrote it with the default mode.
pub(super) fn restrict_config_file(dir: &Path) {
    let path = dir.join(CONFIG_FILE);
    let Ok(metadata) = fs::metadata(&path) else {
        return;
    };
    if metadata.permissions().mode() & 0o077 == 0 {
        return;
    }
    if let Err(error) = fs::set_permissions(&path, fs::Permissions::from_mode(0o600)) {
        tracing::warn!(%error, path = %path.display(), "config file permissions not restricted");
    }
}
