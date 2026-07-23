//! Ported from `enrichPath()` in `src/index.ts` (packages/core).
//!
//! The TS daemon resolved a user's interactive-shell `PATH` at boot and
//! **mutated `process.env.PATH`**, so every child process it spawned
//! (claude/codex CLIs, `which` detection, title generation, LSP servers, launch
//! processes, `lsof`/`kill`) inherited a full toolchain PATH. In a packaged app
//! the daemon starts from a bare launchd/login PATH (`/usr/bin:/bin:…`), so
//! without this the CLIs live in `/opt/homebrew/bin` or `~/.local/bin` and
//! spawns fail with `ENOENT`.
//!
//! Under edition 2024 `std::env::set_var` is `unsafe` and these crates are
//! `#![forbid(unsafe_code)]`, so the resolved value cannot be written back into
//! the process env. Instead it is captured once at boot as a [`ResolvedPath`]
//! and threaded explicitly into every spawn site as an `env("PATH", …)` override
//! — the same effect the TS achieved by mutating the shared env.

use std::sync::Arc;

/// The login-shell-resolved `PATH`, captured once at boot and threaded into
/// child-process spawns. Cheap to clone (`Arc<str>` inside).
#[derive(Clone, Debug)]
pub struct ResolvedPath(Arc<str>);

impl ResolvedPath {
    /// Resolve the interactive-shell `PATH` (mirrors `enrichPath()`): probe the
    /// login shell for its `PATH`, falling back to the current `PATH` plus the
    /// common user/toolchain bin dirs when the shell probe fails or is empty.
    ///
    /// The blocking `SHELL -lic 'echo "$PATH"'` probe is the sanctioned boot-time
    /// exception to the daemon's async-only I/O rule (it runs once, before the
    /// tokio runtime spawns any work).
    ///
    /// Under `E2E_MODE` the probe is skipped: the e2e harness spawns the daemon
    /// with a full inherited `PATH` and re-spawns it once per describe (100+ a
    /// run), where a ~1.5s interactive-shell probe would dominate every boot. The
    /// [`fallback`](Self::fallback) already prepends the toolchain bin dirs to that
    /// inherited `PATH`, so child spawns still resolve.
    #[must_use]
    pub fn resolve() -> Self {
        if std::env::var_os("E2E_MODE").is_some() {
            return Self::fallback();
        }
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        match std::process::Command::new(&shell)
            .args(["-lic", "echo \"$PATH\""])
            .output()
        {
            Ok(out) => {
                let resolved = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !resolved.is_empty() {
                    tracing::debug!(
                        shell,
                        path_length = resolved.split(':').count(),
                        "enrichPath: resolved from login shell"
                    );
                    return Self(Arc::from(resolved.as_str()));
                }
            }
            Err(err) => {
                tracing::warn!(%err, "enrichPath: login shell failed, using fallback");
            }
        }
        Self::fallback()
    }

    /// The `enrichPath` fallback: prepend `~/.local/bin`, `/usr/local/bin`, and
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
            "enrichPath: fallback applied"
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
