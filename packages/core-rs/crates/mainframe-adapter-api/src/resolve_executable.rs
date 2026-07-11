//! Ported from `packages/core/src/adapters/resolve-executable.ts`.
//!
//! Resolves an adapter's CLI executable path (configured → detected → fallback)
//! and persists a detected absolute path back to settings. The TS `ResolverDeps`
//! carried an inline `{ settings: { get, set } }`; here settings persistence goes
//! through the `SettingsWriter` trait so this crate never depends on `mainframe-db`
//! (avoids a db → adapter-api → db cycle). The module-level `resolveMemo` becomes
//! an injectable `ResolveMemo` value (CONCURRENCY.tsv row 136 — no module global).

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, PoisonError};
use std::time::{Duration, Instant};

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

/// Injected dependencies for resolution. `platform` mirrors `NodeJS.Platform`
/// (`"win32"` selects `where`, else `which`); `None` falls back to the build target.
pub struct ResolverDeps<'a> {
    pub settings: &'a dyn SettingsWriter,
    pub run: &'a dyn Runner,
    pub platform: Option<String>,
}

/// Default `run` implementation — spawns the child and captures stdout, never
/// throwing (a spawn error or timeout maps to `{ ok: false }`). Mirrors the TS
/// `defaultRun` (which resolves `{ ok: !err }` from `execFile`).
///
/// `path` is the boot-resolved login-shell `PATH` (see
/// `mainframe_runtime::ResolvedPath`). It must be threaded here so `which`/`where`
/// detection and version probes find CLIs installed outside the packaged app's
/// bare `PATH` — the TS twin relied on `enrichPath` having mutated
/// `process.env.PATH`.
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
    match tokio::time::timeout(dur, command.output()).await {
        Ok(Ok(out)) => RunResult {
            ok: out.status.success(),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        },
        Ok(Err(_)) | Err(_) => RunResult {
            ok: false,
            stdout: String::new(),
        },
    }
}

/// `\d+\.\d+\.\d+` — the first `N.N.N` triple in `stdout`. Hand-rolled (no regex
/// crate); mirrors the TS `parseVersion` local to `resolve-executable.ts`.
fn parse_version(stdout: &str) -> Option<String> {
    let b = stdout.as_bytes();
    let n = b.len();
    let mut i = 0;
    while i < n {
        if b[i].is_ascii_digit() {
            let mut j = i;
            while j < n && b[j].is_ascii_digit() {
                j += 1;
            }
            if j < n && b[j] == b'.' {
                j += 1;
                let g2 = j;
                while j < n && b[j].is_ascii_digit() {
                    j += 1;
                }
                if j > g2 && j < n && b[j] == b'.' {
                    j += 1;
                    let g3 = j;
                    while j < n && b[j].is_ascii_digit() {
                        j += 1;
                    }
                    if j > g3 {
                        return Some(stdout[i..j].to_string());
                    }
                }
            }
        }
        i += 1;
    }
    None
}

/// `(valid, version)` — TS returns `{ valid:false }`, `{ valid:true }`, or
/// `{ valid:true, version }`.
async fn validate(path: &str, run: &dyn Runner) -> (bool, Option<String>) {
    let r = run
        .run(path.to_string(), vec!["--version".to_string()], Some(5_000))
        .await;
    if !r.ok {
        return (false, None);
    }
    (true, parse_version(&r.stdout))
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
    let is_win = match deps.platform.as_deref() {
        Some(p) => p == "win32",
        None => cfg!(windows),
    };
    let finder = if is_win { "where" } else { "which" };
    let found = deps
        .run
        .run(finder.to_string(), vec![bare.to_string()], Some(5_000))
        .await;
    if found.ok {
        let abs = found
            .stdout
            .split(['\r', '\n'])
            .map(str::trim)
            .find(|s| !s.is_empty());
        if let Some(abs) = abs {
            let (valid, version) = validate(abs, deps.run).await;
            return ResolvedExecutable {
                path: abs.to_string(),
                source: ExecutableSource::Detected,
                valid,
                version,
            };
        }
    }
    ResolvedExecutable {
        path: bare.to_string(),
        source: ExecutableSource::Fallback,
        valid: false,
        version: None,
    }
}

const RESOLVE_MEMO_TTL_MS: u64 = 5_000;

/// Short-TTL memo around `resolve_adapter_executable`. Injected value (not a
/// module global): the settings GET endpoint is polled and resolution spawns
/// child processes, so a 5s in-process cache keeps a burst of polls from
/// re-spawning. `resolve_adapter_executable` itself stays unmemoized for tests.
#[derive(Default)]
pub struct ResolveMemo {
    inner: Mutex<HashMap<String, (Instant, ResolvedExecutable)>>,
}

impl ResolveMemo {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn resolve_adapter_executable_cached(
        &self,
        adapter_id: &str,
        deps: &ResolverDeps<'_>,
    ) -> ResolvedExecutable {
        {
            let guard = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some((at, value)) = guard.get(adapter_id)
                && at.elapsed() < Duration::from_millis(RESOLVE_MEMO_TTL_MS)
            {
                return value.clone();
            }
        }
        let value = resolve_adapter_executable(adapter_id, deps).await;
        self.inner
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(adapter_id.to_string(), (Instant::now(), value.clone()));
        value
    }

    pub fn clear(&self) {
        self.inner
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
    }
}

pub async fn backfill_adapter_executables(adapter_ids: &[String], deps: &ResolverDeps<'_>) {
    // The TS body is wrapped in try/catch that logs "executable backfill failed";
    // the Rust deps are infallible-by-type (run captures failures as RunResult,
    // settings get/set return no error), so there is no error path to catch.
    for id in adapter_ids {
        if deps
            .settings
            .get("provider", &format!("{id}.executablePath"))
            .is_some()
        {
            continue;
        }
        let r = resolve_adapter_executable(id, deps).await;
        if r.source == ExecutableSource::Detected {
            deps.settings
                .set("provider", &format!("{id}.executablePath"), &r.path);
            tracing::info!(
                module = "resolve-executable",
                adapter_id = id.as_str(),
                path = r.path.as_str(),
                "backfilled adapter executable path"
            );
        }
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
        fn count(&self) -> usize {
            self.calls.lock().unwrap().len()
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
        let deps = ResolverDeps {
            settings: &s,
            run: &runner,
            platform: Some("darwin".into()),
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
    async fn detects_via_which_on_posix_and_reports_detected() {
        let runner = FnRunner::new(|cmd: &str, args: &[String]| {
            if cmd == "which" {
                ok("/opt/homebrew/bin/claude\n")
            } else if has_version(args) {
                ok("claude 9.9.9\n")
            } else {
                fail()
            }
        });
        let s = MapSettings::new();
        let deps = ResolverDeps {
            settings: &s,
            run: &runner,
            platform: Some("darwin".into()),
        };
        let r = resolve_adapter_executable("claude", &deps).await;
        assert_eq!(
            r,
            ResolvedExecutable {
                path: "/opt/homebrew/bin/claude".into(),
                source: ExecutableSource::Detected,
                valid: true,
                version: Some("9.9.9".into()),
            }
        );
        assert!(runner.called_with("which", &["claude"]));
    }

    #[tokio::test]
    async fn detects_via_where_on_win32() {
        let runner = FnRunner::new(|cmd: &str, _args: &[String]| {
            if cmd == "where" {
                ok("C:\\bin\\codex.exe\r\n")
            } else {
                ok("codex 1.0.0")
            }
        });
        let s = MapSettings::new();
        let deps = ResolverDeps {
            settings: &s,
            run: &runner,
            platform: Some("win32".into()),
        };
        let r = resolve_adapter_executable("codex", &deps).await;
        assert_eq!(r.source, ExecutableSource::Detected);
        assert_eq!(r.path, "C:\\bin\\codex.exe");
    }

    #[tokio::test]
    async fn falls_back_to_bare_name_when_nothing_is_found() {
        let runner = FnRunner::new(|_cmd: &str, _args: &[String]| fail());
        let s = MapSettings::new();
        let deps = ResolverDeps {
            settings: &s,
            run: &runner,
            platform: Some("darwin".into()),
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

    #[tokio::test]
    async fn backfill_writes_detected_absolute_path_only_when_config_is_empty() {
        let runner = FnRunner::new(|cmd: &str, args: &[String]| {
            if cmd == "which" {
                ok("/opt/homebrew/bin/claude\n")
            } else if has_version(args) {
                ok("claude 1.0.0")
            } else {
                fail()
            }
        });
        let s = MapSettings::new();
        let ids = vec!["claude".to_string()];
        {
            let deps = ResolverDeps {
                settings: &s,
                run: &runner,
                platform: Some("darwin".into()),
            };
            backfill_adapter_executables(&ids, &deps).await;
        }
        assert_eq!(
            s.get("provider", "claude.executablePath"),
            Some("/opt/homebrew/bin/claude".into())
        );

        let runner2 = FnRunner::new(|_cmd: &str, _args: &[String]| ok("/somewhere/else/claude\n"));
        let deps2 = ResolverDeps {
            settings: &s,
            run: &runner2,
            platform: Some("darwin".into()),
        };
        backfill_adapter_executables(&ids, &deps2).await;
        assert_eq!(
            s.get("provider", "claude.executablePath"),
            Some("/opt/homebrew/bin/claude".into())
        );
    }

    #[tokio::test]
    async fn does_not_backfill_when_detection_fails() {
        let runner = FnRunner::new(|_cmd: &str, _args: &[String]| fail());
        let s = MapSettings::new();
        let deps = ResolverDeps {
            settings: &s,
            run: &runner,
            platform: Some("linux".into()),
        };
        backfill_adapter_executables(&["codex".to_string()], &deps).await;
        assert_eq!(s.get("provider", "codex.executablePath"), None);
    }

    #[tokio::test]
    async fn memoizes_within_the_ttl_and_re_resolves_after_clear() {
        let runner = FnRunner::new(|cmd: &str, args: &[String]| {
            if cmd == "which" {
                ok("/opt/homebrew/bin/claude\n")
            } else if has_version(args) {
                ok("claude 1.0.0")
            } else {
                fail()
            }
        });
        let s = MapSettings::new();
        let memo = ResolveMemo::new();
        let deps = ResolverDeps {
            settings: &s,
            run: &runner,
            platform: Some("darwin".into()),
        };

        let first = memo
            .resolve_adapter_executable_cached("claude", &deps)
            .await;
        let calls_after_first = runner.count();
        assert!(calls_after_first > 0);

        let second = memo
            .resolve_adapter_executable_cached("claude", &deps)
            .await;
        assert_eq!(second, first);
        assert_eq!(runner.count(), calls_after_first);

        memo.clear();
        memo.resolve_adapter_executable_cached("claude", &deps)
            .await;
        assert!(runner.count() > calls_after_first);
    }

    #[tokio::test]
    async fn keys_the_memo_by_adapter_id() {
        let runner = FnRunner::new(|cmd: &str, args: &[String]| {
            if cmd == "which" {
                ok(&format!("/bin/{}\n", args[0]))
            } else if has_version(args) {
                ok("1.0.0")
            } else {
                fail()
            }
        });
        let s = MapSettings::new();
        let memo = ResolveMemo::new();
        let deps = ResolverDeps {
            settings: &s,
            run: &runner,
            platform: Some("darwin".into()),
        };
        let claude = memo
            .resolve_adapter_executable_cached("claude", &deps)
            .await;
        let codex = memo.resolve_adapter_executable_cached("codex", &deps).await;
        assert_eq!(claude.path, "/bin/claude");
        assert_eq!(codex.path, "/bin/codex");
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

// PORT STATUS: src/adapters/resolve-executable.ts (109 lines)
// confidence: high
// notes: SettingsWriter trait replaces the inline `{settings:{get,set}}` dep (no
// notes: mainframe-db cycle); module-level resolveMemo → injectable ResolveMemo
// notes: (CONCURRENCY.tsv row 136, rule 8). parseVersion hand-rolled (no regex
// notes: crate). backfill try/catch collapses — deps are infallible-by-type. All
// notes: 10 vitest assertions ported.
// todos: 0
