//! A fake `gh` on disk. Tests point `GhCli` at this script instead of the
//! developer's real CLI, so they can assert the exact argv and request body
//! Mainframe sends, and can stage a logged-out or missing CLI that no real
//! machine reproduces on demand.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use tempfile::TempDir;

use super::gh::GhCli;

pub(crate) struct StubGh {
    dir: TempDir,
}

impl StubGh {
    /// Signed in; every other subcommand succeeds with `stdout`.
    pub(crate) fn ready(stdout: &str) -> Self {
        Self::new(0, 0, stdout, "")
    }

    /// Signed in, but the API call fails — `gh`'s own stderr is what the step
    /// failure has to carry.
    pub(crate) fn failing(code: i32, stderr: &str) -> Self {
        Self::new(0, code, "", stderr)
    }

    /// Installed but logged out: `gh auth status` exits non-zero.
    pub(crate) fn logged_out() -> Self {
        Self::new(
            1,
            1,
            "",
            "gh: To get started with GitHub CLI, run: gh auth login",
        )
    }

    fn new(auth_exit: i32, exit: i32, stdout: &str, stderr: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let at = |name: &str| dir.path().join(name).display().to_string();
        fs::write(dir.path().join("stdout"), stdout).unwrap();
        fs::write(dir.path().join("stderr"), stderr).unwrap();

        // Replayed from files rather than inlined, so a fixture carrying quotes
        // can't reshape the script.
        let script = format!(
            "#!/bin/sh\n\
             printf '%s\\n' \"$*\" >> '{calls}'\n\
             cat >> '{stdin}'\n\
             case \"$1\" in auth) exit {auth_exit} ;; esac\n\
             cat '{stdout}'\n\
             cat '{stderr}' >&2\n\
             exit {exit}\n",
            calls = at("calls"),
            stdin = at("stdin"),
            stdout = at("stdout"),
            stderr = at("stderr"),
        );
        let bin = dir.path().join("gh");
        fs::write(&bin, script).unwrap();
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        Self { dir }
    }

    pub(crate) fn cli(&self) -> GhCli {
        GhCli::with_bin(self.bin().display().to_string())
    }

    fn bin(&self) -> PathBuf {
        self.dir.path().join("gh")
    }

    /// One line per invocation, arguments joined by a space.
    pub(crate) fn calls(&self) -> Vec<String> {
        fs::read_to_string(self.dir.path().join("calls"))
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect()
    }

    /// Everything piped to `gh` — in practice the one JSON body `--input -`
    /// reads.
    pub(crate) fn stdin(&self) -> String {
        fs::read_to_string(self.dir.path().join("stdin")).unwrap_or_default()
    }
}

/// A path holding no binary, for the not-installed case.
pub(crate) fn missing_gh() -> GhCli {
    GhCli::with_bin("/nonexistent/mainframe-tests/gh")
}
