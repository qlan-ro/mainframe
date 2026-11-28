//! On-disk cache of the last successful login-shell capture.
//!
//! The daemon starts from this cache so a slow shell never delays it; the
//! background refresh rewrites it on every launch. A cached env is trusted only
//! when it was captured from the same `$SHELL` and no shell start-up file has
//! changed since the capture began — editing `.zshrc` (or `/etc/paths`, …)
//! makes the next launch wait for a fresh capture instead.
//!
//! The file holds only what the shell adds to the app's own env (see
//! [`super::delta`]): values the app inherits from launchd or a terminal are
//! never stored, so they always come from the current launch. A shell-set
//! `SSH_AUTH_SOCK` (1Password, Secretive, gpg-agent) is kept, but dropped on
//! read once its socket is gone, as with `eval $(ssh-agent)` after a reboot.
//! The delta can include tokens the user exports from their shell profile, so
//! the file is written owner-only (0600).

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::delta::{is_never_cached, without_never_cached};
use super::Env;

/// Bump when the file layout or the meaning of a field changes. 2: `env` is the
/// shell's delta over the process env, not the full capture.
const CACHE_VERSION: u32 = 2;

pub const CACHE_FILE_NAME: &str = "shell-env.json";

#[derive(Serialize, Deserialize)]
struct CacheFile {
    version: u32,
    shell: String,
    /// When the capture that produced `env` started, in ms since the epoch.
    captured_at_ms: u64,
    /// Digest of the exported universal variables in fish's `fish_variables`
    /// (`None` when there is no such file). Compared instead of the file's
    /// mtime, which changes on every universal-variable write.
    #[serde(default)]
    fish_exports: Option<u64>,
    /// What the shell added to or changed in the process env.
    env: Env,
}

/// What a cached capture is valid for: the shell, the home directory, and the
/// app's process env (which supplies `ZDOTDIR` / `XDG_CONFIG_HOME` when the
/// delta does not set them).
pub struct CacheScope<'a> {
    pub shell: &'a str,
    pub home: Option<&'a Path>,
    pub base: &'a Env,
}

impl CacheScope<'_> {
    fn dir(&self, env: &Env, key: &str) -> Option<PathBuf> {
        env.get(key)
            .or_else(|| self.base.get(key))
            .map(PathBuf::from)
    }

    fn fish_dir(&self, env: &Env) -> Option<PathBuf> {
        let config = self
            .dir(env, "XDG_CONFIG_HOME")
            .or_else(|| self.home.map(|home| home.join(".config")))?;
        Some(config.join("fish"))
    }
}

/// Read a cached shell delta. `None` when the file is missing, unreadable, from
/// another shell or version, has no PATH, or is older than a shell start-up
/// file. The reason is logged.
pub fn read(path: &Path, scope: &CacheScope<'_>) -> Option<Env> {
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
    if file.version != CACHE_VERSION || file.shell != scope.shell {
        tracing::info!(
            cached_shell = %file.shell,
            shell = scope.shell,
            version = file.version,
            "cached login-shell env is for another shell or version"
        );
        return None;
    }
    if !file.env.get("PATH").is_some_and(|p| !p.is_empty()) {
        tracing::warn!("cached login-shell env has no PATH");
        return None;
    }
    let mut env = without_never_cached(file.env);
    drop_dead_ssh_agent(&mut env);
    let captured_at = UNIX_EPOCH + Duration::from_millis(file.captured_at_ms);
    let (zdotdir, fish_dir) = (scope.dir(&env, "ZDOTDIR"), scope.fish_dir(&env));
    let dirs = StartupDirs {
        home: scope.home,
        zdotdir: zdotdir.as_deref(),
        fish: fish_dir.as_deref(),
    };
    if let Some(changed) = newer_startup_file(captured_at, &dirs) {
        tracing::info!(
            file = %changed.display(),
            "shell start-up file changed since the cached capture; waiting for a fresh one"
        );
        return None;
    }
    if fish_dir.as_deref().and_then(fish_exports_digest) != file.fish_exports {
        tracing::info!("fish exported universal variables changed since the cached capture");
        return None;
    }
    Some(env)
}

/// A cached `SSH_AUTH_SOCK` whose socket no longer exists (an agent the
/// profile started on an earlier boot) is dropped, with its `SSH_AGENT_PID`,
/// so the inherited launchd socket applies instead.
fn drop_dead_ssh_agent(env: &mut Env) {
    let dead = env
        .get("SSH_AUTH_SOCK")
        .is_some_and(|sock| std::fs::symlink_metadata(sock).is_err());
    if dead {
        env.remove("SSH_AUTH_SOCK");
        env.remove("SSH_AGENT_PID");
        tracing::info!("cached SSH_AUTH_SOCK no longer exists; using the inherited one");
    }
}

/// Write `env`, captured starting at `captured_at`, atomically and owner-only.
pub fn write(
    path: &Path,
    scope: &CacheScope<'_>,
    env: &Env,
    captured_at: SystemTime,
) -> std::io::Result<()> {
    let captured_at_ms = captured_at
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let env = without_never_cached(env.clone());
    let fish_exports = scope
        .fish_dir(&env)
        .as_deref()
        .and_then(fish_exports_digest);
    let body = serde_json::to_vec(&CacheFile {
        version: CACHE_VERSION,
        shell: scope.shell.to_string(),
        captured_at_ms,
        fish_exports,
        env,
    })
    .map_err(std::io::Error::other)?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = tmp_path(path);
    // A leftover temp file (a crash mid-write) would keep its old mode, so it
    // is removed and the new one created fresh with 0600.
    match std::fs::remove_file(&tmp) {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => return Err(err),
        _ => {}
    }
    {
        use std::io::Write;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
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

/// FNV-1a over the `SETUVAR --export` lines of `fish_variables` (stable across
/// Rust releases, unlike `DefaultHasher`). Other universal variables are
/// ignored: they never reach the environment.
fn fish_exports_digest(fish_dir: &Path) -> Option<u64> {
    let text = std::fs::read_to_string(fish_dir.join("fish_variables")).ok()?;
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for line in text
        .lines()
        .filter(|line| line.starts_with("SETUVAR --export"))
    {
        for byte in line.bytes().chain(std::iter::once(b'\n')) {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    Some(hash)
}

fn tmp_path(path: &Path) -> PathBuf {
    path.with_extension(format!("json.tmp-{}", std::process::id()))
}

/// Names of the keys whose values differ between `old` and `new`, sorted,
/// ignoring keys that are never cached. Only names are returned so values (which can
/// be secrets) never reach the log.
pub fn changed_keys(old: &Env, new: &Env) -> Vec<String> {
    let mut keys: Vec<String> = old
        .keys()
        .chain(new.keys())
        .filter(|k| !is_never_cached(k))
        .filter(|k| old.get(*k) != new.get(*k))
        .cloned()
        .collect();
    keys.sort();
    keys.dedup();
    keys
}

/// Where per-user shell start-up files live.
struct StartupDirs<'a> {
    home: Option<&'a Path>,
    /// `$ZDOTDIR` (zsh), else `home`.
    zdotdir: Option<&'a Path>,
    /// `$XDG_CONFIG_HOME/fish`, else `home/.config/fish`.
    fish: Option<&'a Path>,
}

/// The first shell start-up file modified after `captured_at`, if any.
fn newer_startup_file(captured_at: SystemTime, dirs: &StartupDirs<'_>) -> Option<PathBuf> {
    startup_files(dirs).into_iter().find(|file| {
        std::fs::metadata(file)
            .and_then(|m| m.modified())
            .is_ok_and(|modified| modified > captured_at)
    })
}

/// Files a login or interactive shell reads that can change the captured env.
/// `/etc/paths.d` and fish's `conf.d` are listed as directories (adding or
/// removing an entry updates their mtime) and, for `conf.d`, with each entry.
/// fish's `fish_variables` is checked by content instead (see
/// [`fish_exports_digest`]).
fn startup_files(dirs: &StartupDirs<'_>) -> Vec<PathBuf> {
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
    if let Some(home) = dirs.home {
        let zsh_dir = dirs.zdotdir.unwrap_or(home);
        for name in [".zshenv", ".zprofile", ".zshrc", ".zlogin"] {
            files.push(zsh_dir.join(name));
        }
        for name in [".bash_profile", ".bash_login", ".profile", ".bashrc"] {
            files.push(home.join(name));
        }
    }
    if let Some(fish) = dirs.fish {
        files.push(fish.join("config.fish"));
        let conf_d = fish.join("conf.d");
        if let Ok(entries) = std::fs::read_dir(&conf_d) {
            files.extend(entries.flatten().map(|entry| entry.path()));
        }
        files.push(conf_d);
    }
    files
}

#[cfg(test)]
#[path = "cache_tests.rs"]
mod tests;
