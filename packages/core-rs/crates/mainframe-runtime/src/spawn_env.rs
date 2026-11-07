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

use std::sync::Arc;
use std::time::Duration;

/// Bounds a login shell that hangs at start-up. Well past a healthy shell, which
/// takes about 1.5s, or a slow one on a cold boot, which gets no second probe.
const SHELL_PROBE_TIMEOUT: Duration = Duration::from_secs(30);

/// Interactive start-up files may print anything, so the value is fenced.
const SHELL_PROBE_OPEN: &str = "<mf-path>";
const SHELL_PROBE_CLOSE: &str = "</mf-path>";

/// The login-shell-resolved `PATH`, captured once at boot and threaded into
/// child-process spawns. Cheap to clone (`Arc<str>` inside).
#[derive(Clone, Debug)]
pub struct ResolvedPath(Arc<str>);

impl ResolvedPath {
    pub fn apply(&self, command: &mut tokio::process::Command) {
        command.env("PATH", self.as_str());
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
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        match probe_login_shell(&shell, SHELL_PROBE_TIMEOUT).await {
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

    #[test]
    fn output_without_a_fenced_value_yields_nothing() {
        assert_eq!(fenced_path("no markers here"), None);
        assert_eq!(fenced_path("<mf-path>unterminated"), None);
        assert_eq!(fenced_path("<mf-path>  </mf-path>"), None);
    }
}
