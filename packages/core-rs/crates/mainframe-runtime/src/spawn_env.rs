//! Resolves the user's interactive-shell `PATH` at boot so every child process
//! the daemon spawns (claude/codex CLIs, title generation, LSP servers, launch
//! processes, `ps`/`lsof`/`pgrep`) gets a full toolchain PATH, and so CLI
//! detection ([`ResolvedPath::find`]) scans the same directories. In a
//! packaged app the daemon starts from a bare launchd/login PATH
//! (`/usr/bin:/bin:…`), so without this the CLIs live in `/opt/homebrew/bin`
//! or `~/.local/bin` and spawns fail with `ENOENT`.
//!
//! Under edition 2024 `std::env::set_var` is `unsafe` and these crates are
//! `#![forbid(unsafe_code)]`, so the resolved value cannot be written back into
//! the process env. Instead it is captured once at boot as a [`ResolvedPath`]
//! and threaded explicitly into every spawn site as an `env("PATH", …)` override.
//!
//! The desktop app already captures the login-shell env (and caches it), so a
//! sidecar it spawns gets that env as its own process env plus
//! [`SHELL_ENV_RESOLVED_VAR`]` = 1`. The daemon then takes `PATH` from its own
//! env and skips the probe, which otherwise delays the HTTP bind by the whole
//! interactive start-up of the user's shell. A daemon started any other way
//! (standalone, CLI, remote) does not have the flag and probes as before.

use std::sync::Arc;
use std::time::Duration;

/// Bounds a login shell that hangs at start-up. Well past a healthy shell, which
/// takes about 1.5s, or a slow one on a cold boot, which gets no second probe.
const SHELL_PROBE_TIMEOUT: Duration = Duration::from_secs(30);

/// Interactive start-up files may print anything, so the value is fenced.
const SHELL_PROBE_OPEN: &str = "<mf-path>";
const SHELL_PROBE_CLOSE: &str = "</mf-path>";

/// Set to `1` by the desktop app on the sidecar it spawns when the process env
/// it hands over is the user's resolved login-shell env. The handover is the
/// child's own env (local to the process tree, never sent anywhere); only the
/// flag's presence and the PATH entry count are logged.
pub const SHELL_ENV_RESOLVED_VAR: &str = "MAINFRAME_SHELL_ENV_RESOLVED";

/// The login-shell-resolved `PATH`, captured once at boot and threaded into
/// child-process spawns. Cheap to clone (`Arc<str>` inside).
#[derive(Clone, Debug)]
pub struct ResolvedPath(Arc<str>);

impl ResolvedPath {
    /// Set `PATH` on a child spawn. Also drops [`SHELL_ENV_RESOLVED_VAR`], so a
    /// daemon a child starts (in a launch config, a test run) probes for itself.
    pub fn apply(&self, command: &mut tokio::process::Command) {
        command.env("PATH", self.as_str());
        command.env_remove(SHELL_ENV_RESOLVED_VAR);
    }

    pub fn find(&self, name: &str) -> Option<std::path::PathBuf> {
        use std::os::unix::fs::PermissionsExt;
        std::env::split_paths(self.as_str())
            .map(|dir| dir.join(name))
            .find(|path| {
                path.metadata().is_ok_and(|metadata| {
                    metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
                })
            })
    }

    /// Resolve the interactive-shell `PATH`, falling back to the current
    /// `PATH` plus the common user/toolchain bin dirs when the probe fails.
    ///
    /// Under `E2E_MODE` the probe is skipped: the e2e harness spawns the daemon
    /// with a full inherited `PATH` and re-spawns it once per describe (100+ a
    /// run), where a ~1.5s interactive-shell probe would dominate every boot. The
    /// [`fallback`](Self::fallback) already prepends the toolchain bin dirs to that
    /// inherited `PATH`, so child spawns still resolve.
    pub async fn resolve() -> Self {
        if std::env::var_os("E2E_MODE").is_some() {
            return Self::fallback();
        }
        let handover = handed_over_path(
            std::env::var_os(SHELL_ENV_RESOLVED_VAR),
            std::env::var("PATH").ok(),
        );
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        Self::resolve_with(handover, &shell, SHELL_PROBE_TIMEOUT).await
    }

    /// Use the handed-over `PATH` when present; otherwise probe `shell`.
    async fn resolve_with(handover: Option<String>, shell: &str, timeout: Duration) -> Self {
        if let Some(path) = handover {
            tracing::info!(
                entries = path.split(':').count(),
                "using the login-shell PATH handed over by the desktop app, skipping the probe"
            );
            return Self(Arc::from(path));
        }
        match probe_login_shell(shell, timeout).await {
            Some(path) => Self(Arc::from(path)),
            None => Self::fallback(),
        }
    }

    /// Prepend `~/.local/bin`, `/usr/local/bin`, and
    /// `/opt/homebrew/bin` (those not already present) to the current `PATH`.
    fn fallback() -> Self {
        let current =
            std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".to_string());
        let home = dirs::home_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let extra = [
            format!("{home}/.local/bin"),
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
        ];
        let seen: std::collections::HashSet<&str> = current.split(':').collect();
        let additions: Vec<&str> = extra
            .iter()
            .map(String::as_str)
            .filter(|p| !seen.contains(p))
            .collect();
        let path = if additions.is_empty() {
            current.clone()
        } else {
            format!("{}:{}", additions.join(":"), current)
        };
        tracing::debug!(
            ?additions,
            total_paths = path.split(':').count(),
            "fallback applied"
        );
        Self(Arc::from(path.as_str()))
    }

    /// Build directly from a `PATH` string (tests, or an already-known value).
    #[must_use]
    pub fn from_value(path: impl Into<Arc<str>>) -> Self {
        Self(path.into())
    }

    /// The resolved `PATH`, ready to pass as `env("PATH", …)`.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::ops::Deref for ResolvedPath {
    type Target = str;
    fn deref(&self) -> &str {
        &self.0
    }
}

/// The process `PATH` when the desktop app flagged it as already resolved
/// (`SHELL_ENV_RESOLVED_VAR=1`) and it is not blank.
fn handed_over_path(flag: Option<std::ffi::OsString>, path: Option<String>) -> Option<String> {
    if flag.as_deref() != Some(std::ffi::OsStr::new("1")) {
        return None;
    }
    path.filter(|path| !path.trim().is_empty())
}

async fn probe_login_shell(shell: &str, timeout: Duration) -> Option<String> {
    let mut command = tokio::process::Command::new(shell);
    command.args([
        "-lic",
        &format!("echo \"{SHELL_PROBE_OPEN}$PATH{SHELL_PROBE_CLOSE}\""),
    ]);
    let output = match crate::process::run_captured(command, Some(timeout)).await {
        Ok(output) => output,
        Err(error) => {
            tracing::warn!(shell, %error, "login shell probe failed, using fallback");
            return None;
        }
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let path = fenced_path(&stdout);
    match path {
        Some(path) => tracing::debug!(
            shell,
            entries = path.split(':').count(),
            "resolved from login shell"
        ),
        None => tracing::warn!(shell, "login shell reported no PATH, using fallback"),
    }
    path.map(str::to_string)
}

fn fenced_path(stdout: &str) -> Option<&str> {
    let (_, rest) = stdout.split_once(SHELL_PROBE_OPEN)?;
    let (path, _) = rest.split_once(SHELL_PROBE_CLOSE)?;
    let path = path.trim();
    (!path.is_empty()).then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::test_support::write_shell_script;

    #[test]
    fn from_value_exposes_the_path_via_as_str_and_deref() {
        let resolved = ResolvedPath::from_value("/opt/homebrew/bin:/usr/bin");
        assert_eq!(resolved.as_str(), "/opt/homebrew/bin:/usr/bin");
        assert_eq!(&*resolved, "/opt/homebrew/bin:/usr/bin");
    }

    #[test]
    fn clone_shares_the_same_value() {
        let a = ResolvedPath::from_value("/x:/y");
        let b = a.clone();
        assert_eq!(a.as_str(), b.as_str());
    }

    #[tokio::test]
    async fn the_probe_ignores_what_start_up_files_print() {
        let dir = tempfile::tempdir().unwrap();
        let shell = dir.path().join("chatty-shell");
        write_shell_script(
            &shell,
            "echo 'Welcome back'\nPATH=/probed/bin:/usr/bin\neval \"$2\"\necho 'Goodbye'\n",
        )
        .unwrap();
        assert_eq!(
            probe_login_shell(shell.to_str().unwrap(), Duration::from_secs(5))
                .await
                .as_deref(),
            Some("/probed/bin:/usr/bin")
        );
    }

    #[tokio::test]
    async fn a_shell_that_hangs_is_abandoned_at_the_deadline() {
        let dir = tempfile::tempdir().unwrap();
        let shell = dir.path().join("hung-shell");
        write_shell_script(&shell, "exec sleep 60\n").unwrap();
        assert_eq!(
            probe_login_shell(shell.to_str().unwrap(), Duration::from_millis(200)).await,
            None
        );
    }

    /// A shell that records that it ran, then reports `/probed/bin`.
    fn marking_shell(dir: &std::path::Path) -> (std::path::PathBuf, std::path::PathBuf) {
        let shell = dir.join("marking-shell");
        let marker = dir.join("probed");
        write_shell_script(
            &shell,
            &format!(
                "touch '{}'\nPATH=/probed/bin:/usr/bin\neval \"$2\"\n",
                marker.display()
            ),
        )
        .unwrap();
        (shell, marker)
    }

    #[tokio::test]
    async fn a_handed_over_path_skips_the_probe() {
        let dir = tempfile::tempdir().unwrap();
        let (shell, marker) = marking_shell(dir.path());

        let resolved = ResolvedPath::resolve_with(
            Some("/handed/bin:/usr/bin".to_string()),
            shell.to_str().unwrap(),
            Duration::from_secs(5),
        )
        .await;

        assert_eq!(resolved.as_str(), "/handed/bin:/usr/bin");
        assert!(
            !marker.exists(),
            "the login shell was probed despite the handover"
        );
    }

    #[tokio::test]
    async fn without_a_handover_the_probe_runs() {
        let dir = tempfile::tempdir().unwrap();
        let (shell, marker) = marking_shell(dir.path());

        let resolved =
            ResolvedPath::resolve_with(None, shell.to_str().unwrap(), Duration::from_secs(5)).await;

        assert_eq!(resolved.as_str(), "/probed/bin:/usr/bin");
        assert!(marker.exists(), "the login shell was not probed");
    }

    #[test]
    fn the_handover_needs_the_flag_and_a_path() {
        let flag = Some(std::ffi::OsString::from("1"));
        let path = Some("/opt/homebrew/bin:/usr/bin".to_string());
        assert_eq!(
            handed_over_path(flag.clone(), path.clone()).as_deref(),
            Some("/opt/homebrew/bin:/usr/bin")
        );
        assert_eq!(handed_over_path(None, path.clone()), None);
        assert_eq!(handed_over_path(Some("0".into()), path.clone()), None);
        assert_eq!(handed_over_path(Some("true".into()), path), None);
        assert_eq!(handed_over_path(flag.clone(), None), None);
        assert_eq!(handed_over_path(flag, Some("  ".to_string())), None);
    }

    #[test]
    fn cli_tools_are_found_on_a_handed_over_path() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let (git_dir, tools_dir) = (dir.path().join("usr-bin"), dir.path().join("local-bin"));
        for (bin_dir, name) in [
            (&git_dir, "git"),
            (&tools_dir, "claude"),
            (&tools_dir, "codex"),
        ] {
            std::fs::create_dir_all(bin_dir).unwrap();
            let bin = bin_dir.join(name);
            std::fs::write(&bin, "#!/bin/sh\n").unwrap();
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let path = format!("{}:{}", tools_dir.display(), git_dir.display());
        let resolved =
            ResolvedPath::from_value(handed_over_path(Some("1".into()), Some(path)).unwrap());

        assert_eq!(resolved.find("git"), Some(git_dir.join("git")));
        assert_eq!(resolved.find("claude"), Some(tools_dir.join("claude")));
        assert_eq!(resolved.find("codex"), Some(tools_dir.join("codex")));
        assert_eq!(resolved.find("not-installed"), None);
    }

    #[test]
    fn spawned_children_do_not_inherit_the_handover_flag() {
        let mut command = tokio::process::Command::new("true");
        ResolvedPath::from_value("/x").apply(&mut command);

        let envs: Vec<_> = command.as_std().get_envs().collect();
        assert!(envs.contains(&(std::ffi::OsStr::new(SHELL_ENV_RESOLVED_VAR), None)));
        assert!(envs.contains(&(
            std::ffi::OsStr::new("PATH"),
            Some(std::ffi::OsStr::new("/x"))
        )));
    }

    #[test]
    fn output_without_a_fenced_value_yields_nothing() {
        assert_eq!(fenced_path("no markers here"), None);
        assert_eq!(fenced_path("<mf-path>unterminated"), None);
        assert_eq!(fenced_path("<mf-path>  </mf-path>"), None);
    }
}
