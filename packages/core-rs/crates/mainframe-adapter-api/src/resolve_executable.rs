//! Resolves an adapter's CLI executable path (configured → detected → fallback).
//! The configured path is read through the `SettingsKv` contract so this crate
//! never depends on `mainframe-db` (avoids a db → adapter-api → db cycle). The
//! resolve memo is an injectable `ResolveMemo` value, not a module global.

use std::collections::HashMap;
use std::sync::LazyLock;
#[cfg(test)]
use std::sync::Mutex;
use std::time::Duration;

use mainframe_runtime::ResolvedPath;
use mainframe_types::settings_kv::SettingsKv;
use serde::{Deserialize, Serialize};

use crate::{BoxFuture, RunResult};

/// Runs a child process and reports `{ ok, stdout }` (mirrors the injected `run`).
pub trait Runner: Send + Sync {
    fn run(
        &self,
        cmd: String,
        args: Vec<String>,
        timeout_ms: Option<u64>,
    ) -> BoxFuture<'_, RunResult>;
}

pub static BARE_NAMES: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {
    HashMap::from([
        ("claude", "claude"),
        ("codex", "codex"),
        ("gemini", "gemini"),
        ("opencode", "opencode"),
    ])
});

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExecutableSource {
    Config,
    Detected,
    Fallback,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedExecutable {
    pub path: String,
    pub source: ExecutableSource,
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

/// Injected dependencies for resolution.
pub struct ResolverDeps<'a> {
    /// Source of `provider.<adapterId>.executablePath`; never written.
    pub settings: &'a dyn SettingsKv,
    pub run: &'a dyn Runner,
    /// The `PATH` scanned for the bare CLI name when no path is configured.
    pub path: &'a ResolvedPath,
}

/// Default `run` implementation — spawns the child and captures stdout, never
/// failing (a spawn error or timeout maps to `{ ok: false }`).
///
/// `path` is the boot-resolved login-shell `PATH` (see
/// `mainframe_runtime::ResolvedPath`). It must be threaded here so version
/// probes find CLIs installed outside the packaged app's bare `PATH`.
pub async fn default_run(
    cmd: &str,
    args: &[String],
    timeout_ms: Option<u64>,
    path: Option<&str>,
) -> RunResult {
    let dur = Duration::from_millis(timeout_ms.unwrap_or(5_000));
    let mut command = tokio::process::Command::new(cmd);
    command.args(args);
    if let Some(path) = path {
        command.env("PATH", path);
    }
    match mainframe_runtime::process::run_captured(command, Some(dur)).await {
        Ok(out) => RunResult {
            ok: out.status.success(),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        },
        Err(_) => RunResult {
            ok: false,
            stdout: String::new(),
        },
    }
}

/// `(valid, version)`: `(false, None)`, `(true, None)`, or `(true, Some(v))`.
async fn validate(path: &str, run: &dyn Runner) -> (bool, Option<String>) {
    let r = run
        .run(path.to_string(), vec!["--version".to_string()], Some(5_000))
        .await;
    if !r.ok {
        return (false, None);
    }
    (
        true,
        crate::version::CliVersion::parse(&r.stdout).map(|v| v.to_string()),
    )
}

/// First executable named `bare` on `path`, scanned off the executor thread.
async fn find_on_path(path: &ResolvedPath, bare: &str) -> Option<String> {
    let path = path.clone();
    let bare = bare.to_string();
    tokio::task::spawn_blocking(move || path.find(&bare))
        .await
        .ok()
        .flatten()
        .map(|found| found.to_string_lossy().into_owned())
}

pub async fn resolve_adapter_executable(
    adapter_id: &str,
    deps: &ResolverDeps<'_>,
) -> ResolvedExecutable {
    let bare = BARE_NAMES.get(adapter_id).copied().unwrap_or(adapter_id);
    let key = format!("{adapter_id}.executablePath");
    let configured = match deps.settings.get("provider", &key).await {
        Ok(configured) => configured,
        Err(err) => {
            tracing::warn!(error = %err, category = "provider", key, "executable path read failed; detecting instead");
            None
        }
    };
    if let Some(configured) = configured {
        let (valid, version) = validate(&configured, deps.run).await;
        return ResolvedExecutable {
            path: configured,
            source: ExecutableSource::Config,
            valid,
            version,
        };
    }
    if let Some(abs) = find_on_path(deps.path, bare).await {
        let (valid, version) = validate(&abs, deps.run).await;
        return ResolvedExecutable {
            path: abs,
            source: ExecutableSource::Detected,
            valid,
            version,
        };
    }
    ResolvedExecutable {
        path: bare.to_string(),
        source: ExecutableSource::Fallback,
        valid: false,
        version: None,
    }
}

#[cfg(test)]
#[path = "resolve_executable_tests.rs"]
mod tests;
