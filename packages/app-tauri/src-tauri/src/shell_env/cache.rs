//! On-disk cache of the last successful login-shell capture.
//!
//! The daemon starts from this cache so a slow shell never delays it; the
//! background refresh rewrites it on every launch. A cached env is trusted only
//! when it was captured from the same `$SHELL` and no shell start-up file has
//! changed since the capture began — editing `.zshrc` (or `/etc/paths`, …)
//! makes the next launch wait for a fresh capture instead.
//!
//! The file holds the full captured env, which can include tokens the user
//! exports from their shell profile, so it is written owner-only (0600).

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::Env;

/// Bump when the file layout or the meaning of a field changes.
const CACHE_VERSION: u32 = 1;

pub const CACHE_FILE_NAME: &str = "shell-env.json";

/// Keys that differ between two captures of an unchanged profile. Ignored when
/// reporting what changed.
const VOLATILE_KEYS: &[&str] = &["_", "PWD", "OLDPWD", "SHLVL"];

#[derive(Serialize, Deserialize)]
struct CacheFile {
    version: u32,
    shell: String,
    /// When the capture that produced `env` started, in ms since the epoch.
    captured_at_ms: u64,
    env: Env,
}

/// Read a cached env for `shell`. `None` when the file is missing, unreadable,
/// from another shell or version, has no PATH, or is older than a shell
/// start-up file. The reason is logged.
pub fn read(path: &Path, shell: &str, home: Option<&Path>) -> Option<Env> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            tracing::info!("no cached login-shell env");
            return None;
        }
        Err(err) => {
            tracing::warn!(error = %err, "cached login-shell env unreadable");
            return None;
        }
    };
    let file: CacheFile = match serde_json::from_str(&raw) {
        Ok(file) => file,
        Err(err) => {
            tracing::warn!(error = %err, "cached login-shell env malformed");
            return None;
        }
    };
    if file.version != CACHE_VERSION || file.shell != shell {
        tracing::info!(
            cached_shell = %file.shell,
            shell,
            version = file.version,
            "cached login-shell env is for another shell or version"
        );
        return None;
    }
    if !file.env.get("PATH").is_some_and(|p| !p.is_empty()) {
        tracing::warn!("cached login-shell env has no PATH");
        return None;
    }
    let captured_at = UNIX_EPOCH + Duration::from_millis(file.captured_at_ms);
    let zdotdir = file.env.get("ZDOTDIR").map(PathBuf::from);
    if let Some(changed) = newer_startup_file(captured_at, home, zdotdir.as_deref()) {
        tracing::info!(
            file = %changed.display(),
            "shell start-up file changed since the cached capture; waiting for a fresh one"
        );
        return None;
    }
    Some(file.env)
}

/// Write `env`, captured from `shell` starting at `captured_at`, atomically and
/// owner-only.
pub fn write(path: &Path, shell: &str, env: &Env, captured_at: SystemTime) -> std::io::Result<()> {
    let captured_at_ms = captured_at
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let body = serde_json::to_vec(&CacheFile {
        version: CACHE_VERSION,
        shell: shell.to_string(),
        captured_at_ms,
        env: env.clone(),
    })
    .map_err(std::io::Error::other)?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("json.tmp-{}", std::process::id()));
    {
        use std::io::Write;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(&body)?;
        file.sync_all()?;
    }
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

/// Names of the keys whose values differ between `old` and `new`, sorted,
/// ignoring [`VOLATILE_KEYS`]. Only names are returned so values (which can be
/// secrets) never reach the log.
pub fn changed_keys(old: &Env, new: &Env) -> Vec<String> {
    let mut keys: Vec<String> = old
        .keys()
        .chain(new.keys())
        .filter(|k| !VOLATILE_KEYS.contains(&k.as_str()))
        .filter(|k| old.get(*k) != new.get(*k))
        .cloned()
        .collect();
    keys.sort();
    keys.dedup();
    keys
}

/// The first shell start-up file modified after `captured_at`, if any.
fn newer_startup_file(
    captured_at: SystemTime,
    home: Option<&Path>,
    zdotdir: Option<&Path>,
) -> Option<PathBuf> {
    startup_files(home, zdotdir).into_iter().find(|file| {
        std::fs::metadata(file)
            .and_then(|m| m.modified())
            .is_ok_and(|modified| modified > captured_at)
    })
}

/// Files a login or interactive shell reads that can change the captured env.
/// `/etc/paths.d` is listed as a directory: adding or removing an entry
/// updates its mtime.
fn startup_files(home: Option<&Path>, zdotdir: Option<&Path>) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = [
        "/etc/zshenv",
        "/etc/zprofile",
        "/etc/zshrc",
        "/etc/zlogin",
        "/etc/profile",
        "/etc/bashrc",
        "/etc/paths",
        "/etc/paths.d",
    ]
    .iter()
    .map(PathBuf::from)
    .collect();
    if let Some(home) = home {
        let zsh_dir = zdotdir.unwrap_or(home);
        for name in [".zshenv", ".zprofile", ".zshrc", ".zlogin"] {
            files.push(zsh_dir.join(name));
        }
        for name in [
            ".bash_profile",
            ".bash_login",
            ".profile",
            ".bashrc",
            ".config/fish/config.fish",
        ] {
            files.push(home.join(name));
        }
    }
    files
}

#[cfg(test)]
#[path = "cache_tests.rs"]
mod tests;
