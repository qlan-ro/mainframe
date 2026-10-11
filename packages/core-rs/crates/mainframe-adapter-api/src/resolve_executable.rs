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
            tracing::warn!(%err, category = "provider", key, "executable path read failed; detecting instead");
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
mod tests {
    use super::*;
    use mainframe_types::settings_kv::{MemorySettings, SettingsError, SettingsResult};

    struct FnRunner<F> {
        f: F,
        calls: Mutex<Vec<(String, Vec<String>)>>,
    }
    impl<F> FnRunner<F> {
        fn new(f: F) -> Self {
            Self {
                f,
                calls: Mutex::new(Vec::new()),
            }
        }
        fn called_with(&self, cmd: &str, args: &[&str]) -> bool {
            let want: Vec<String> = args.iter().map(|a| a.to_string()).collect();
            self.calls
                .lock()
                .unwrap()
                .iter()
                .any(|(c, a)| c == cmd && a == &want)
        }
    }
    impl<F: Fn(&str, &[String]) -> RunResult + Send + Sync> Runner for FnRunner<F> {
        fn run(
            &self,
            cmd: String,
            args: Vec<String>,
            _timeout_ms: Option<u64>,
        ) -> BoxFuture<'_, RunResult> {
            self.calls.lock().unwrap().push((cmd.clone(), args.clone()));
            let r = (self.f)(&cmd, &args);
            Box::pin(async move { r })
        }
    }

    fn ok(stdout: &str) -> RunResult {
        RunResult {
            ok: true,
            stdout: stdout.to_string(),
        }
    }
    fn fail() -> RunResult {
        RunResult {
            ok: false,
            stdout: String::new(),
        }
    }
    fn has_version(args: &[String]) -> bool {
        args.iter().any(|a| a == "--version")
    }

    /// A `PATH` of one directory holding an executable `name` (or nothing).
    fn path_with(name: Option<&str>) -> (tempfile::TempDir, ResolvedPath) {
        let dir = tempfile::tempdir().unwrap();
        if let Some(name) = name {
            use std::os::unix::fs::PermissionsExt;
            let file = dir.path().join(name);
            std::fs::write(&file, "#!/bin/sh\n").unwrap();
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let path = ResolvedPath::from_value(dir.path().to_string_lossy().into_owned());
        (dir, path)
    }

    #[tokio::test]
    async fn uses_a_configured_path_and_validates_via_version() {
        let runner = FnRunner::new(|_cmd: &str, args: &[String]| {
            if has_version(args) {
                ok("claude 1.2.3\n")
            } else {
                fail()
            }
        });
        let s = MemorySettings::default().with(
            "provider",
            "claude.executablePath",
            "/usr/local/bin/claude",
        );
        let (_dir, path) = path_with(Some("claude"));
        let deps = ResolverDeps {
            settings: &s,
            run: &runner,
            path: &path,
        };
        let r = resolve_adapter_executable("claude", &deps).await;
        assert_eq!(
            r,
            ResolvedExecutable {
                path: "/usr/local/bin/claude".into(),
                source: ExecutableSource::Config,
                valid: true,
                version: Some("1.2.3".into()),
            }
        );
        assert!(runner.called_with("/usr/local/bin/claude", &["--version"]));
    }

    #[tokio::test]
    async fn detects_the_bare_name_on_the_resolved_path_and_reports_detected() {
        let runner = FnRunner::new(|_cmd: &str, args: &[String]| {
            if has_version(args) {
                ok("claude 9.9.9\n")
            } else {
                fail()
            }
        });
        let s = MemorySettings::default();
        let (dir, path) = path_with(Some("claude"));
        let deps = ResolverDeps {
            settings: &s,
            run: &runner,
            path: &path,
        };
        let r = resolve_adapter_executable("claude", &deps).await;
        let expected = dir.path().join("claude").to_string_lossy().into_owned();
        assert_eq!(
            r,
            ResolvedExecutable {
                path: expected.clone(),
                source: ExecutableSource::Detected,
                valid: true,
                version: Some("9.9.9".into()),
            }
        );
        assert!(runner.called_with(&expected, &["--version"]));
    }

    #[tokio::test]
    async fn ignores_a_non_executable_file_of_the_same_name() {
        let runner = FnRunner::new(|_cmd: &str, _args: &[String]| ok("codex 1.0.0"));
        let s = MemorySettings::default();
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("codex"), "not executable").unwrap();
        let path = ResolvedPath::from_value(dir.path().to_string_lossy().into_owned());
        let deps = ResolverDeps {
            settings: &s,
            run: &runner,
            path: &path,
        };
        let r = resolve_adapter_executable("codex", &deps).await;
        assert_eq!(r.source, ExecutableSource::Fallback);
        assert_eq!(r.path, "codex");
    }

    #[tokio::test]
    async fn falls_back_to_bare_name_when_nothing_is_found() {
        let runner = FnRunner::new(|_cmd: &str, _args: &[String]| fail());
        let s = MemorySettings::default();
        let (_dir, path) = path_with(None);
        let deps = ResolverDeps {
            settings: &s,
            run: &runner,
            path: &path,
        };
        let r = resolve_adapter_executable("claude", &deps).await;
        assert_eq!(
            r,
            ResolvedExecutable {
                path: "claude".into(),
                source: ExecutableSource::Fallback,
                valid: false,
                version: None,
            }
        );
    }

    #[test]
    fn exposes_a_bare_name_map() {
        assert_eq!(BARE_NAMES.get("claude").copied(), Some("claude"));
        assert_eq!(BARE_NAMES.get("codex").copied(), Some("codex"));
    }

    /// A store whose reads fail, for the unreadable-setting path.
    struct UnreadableSettings;
    impl SettingsKv for UnreadableSettings {
        fn get<'a>(
            &'a self,
            _: &'a str,
            _: &'a str,
        ) -> BoxFuture<'a, SettingsResult<Option<String>>> {
            Box::pin(async { Err(SettingsError::Store("database is locked".into())) })
        }
        fn get_by_category<'a>(
            &'a self,
            _: &'a str,
        ) -> BoxFuture<'a, SettingsResult<HashMap<String, String>>> {
            Box::pin(async { Err(SettingsError::Store("database is locked".into())) })
        }
        fn set<'a>(
            &'a self,
            _: &'a str,
            _: &'a str,
            _: &'a str,
        ) -> BoxFuture<'a, SettingsResult<()>> {
            Box::pin(async { Err(SettingsError::Store("database is locked".into())) })
        }
        fn delete<'a>(&'a self, _: &'a str, _: &'a str) -> BoxFuture<'a, SettingsResult<()>> {
            Box::pin(async { Err(SettingsError::Store("database is locked".into())) })
        }
    }

    #[tokio::test]
    async fn an_unreadable_configured_path_falls_through_to_detection() {
        let runner = FnRunner::new(|_cmd: &str, args: &[String]| {
            if has_version(args) {
                ok("claude 2.0.0\n")
            } else {
                fail()
            }
        });
        let (dir, path) = path_with(Some("claude"));
        let deps = ResolverDeps {
            settings: &UnreadableSettings,
            run: &runner,
            path: &path,
        };
        let r = resolve_adapter_executable("claude", &deps).await;
        assert_eq!(r.source, ExecutableSource::Detected);
        assert_eq!(r.path, dir.path().join("claude").to_string_lossy());
    }

    #[tokio::test]
    async fn default_run_returns_ok_false_for_a_nonexistent_binary() {
        let r = default_run(
            "definitely-not-a-real-binary-xyz",
            &["--version".to_string()],
            Some(2_000),
            None,
        )
        .await;
        assert!(!r.ok);
    }
}
