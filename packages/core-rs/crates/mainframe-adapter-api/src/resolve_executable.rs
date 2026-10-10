//! Resolves an adapter's CLI executable path (configured → detected → fallback)
//! and persists a detected absolute path back to settings. Settings persistence
//! goes through the `SettingsWriter` trait so this crate never depends on
//! `mainframe-db` (avoids a db → adapter-api → db cycle). The resolve memo is an
//! injectable `ResolveMemo` value, not a module global.

use std::collections::HashMap;
use std::sync::LazyLock;
#[cfg(test)]
use std::sync::Mutex;
use std::time::Duration;

use mainframe_runtime::ResolvedPath;
use serde::{Deserialize, Serialize};

use crate::{BoxFuture, RunResult};

/// Persists resolved CLI paths. A trait (not a db handle) so `resolve-executable`
/// stays free of a `mainframe-db` dependency.
pub trait SettingsWriter: Send + Sync {
    fn get(&self, category: &str, key: &str) -> Option<String>;
    fn set(&self, category: &str, key: &str, value: &str);
}

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
    pub settings: &'a dyn SettingsWriter,
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
    let configured = deps
        .settings
        .get("provider", &format!("{adapter_id}.executablePath"));
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

    struct MapSettings {
        store: Mutex<HashMap<String, String>>,
    }
    impl MapSettings {
        fn new() -> Self {
            Self {
                store: Mutex::new(HashMap::new()),
            }
        }
        fn with(pairs: &[(&str, &str)]) -> Self {
            let store = pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();
            Self {
                store: Mutex::new(store),
            }
        }
    }
    impl SettingsWriter for MapSettings {
        fn get(&self, category: &str, key: &str) -> Option<String> {
            self.store
                .lock()
                .unwrap()
                .get(&format!("{category}.{key}"))
                .cloned()
        }
        fn set(&self, category: &str, key: &str, value: &str) {
            self.store
                .lock()
                .unwrap()
                .insert(format!("{category}.{key}"), value.to_string());
        }
    }

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
        let s = MapSettings::with(&[("provider.claude.executablePath", "/usr/local/bin/claude")]);
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
        let s = MapSettings::new();
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
        let s = MapSettings::new();
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
        let s = MapSettings::new();
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
