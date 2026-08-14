//! Ported from `packages/core/src/background-tasks/spool-root.ts`.

use std::path::PathBuf;

/// Real uid of this process — the value `process.getuid()` returns inside the
/// CLI, which names its per-user temp dir `claude-<uid>`. `getuid(2)` cannot fail.
#[cfg(unix)]
pub fn current_uid() -> u32 {
    rustix::process::getuid().as_raw()
}

#[cfg(unix)]
fn claude_dir_name() -> String {
    format!("claude-{}", current_uid())
}

#[cfg(windows)]
fn claude_dir_name() -> String {
    "claude".to_string()
}

#[cfg(unix)]
fn default_tmp_base() -> String {
    "/tmp".to_string()
}

#[cfg(windows)]
fn default_tmp_base() -> String {
    std::env::temp_dir().to_string_lossy().into_owned()
}

// `std::env::set_var` is unsafe under edition 2024 and this crate forbids
// unsafe, so tests can't pin `CLAUDE_CODE_TMPDIR` — the override is threaded
// through this inner function instead.
fn spool_root_with(tmpdir_override: Option<String>) -> PathBuf {
    PathBuf::from(tmpdir_override.unwrap_or_else(default_tmp_base)).join(claude_dir_name())
}

/// Absolute path of the Claude CLI's per-user spool root.
///  - Linux/mac: `/tmp/claude-{uid}`
///  - Win: `%TEMP%/claude`
///  - `CLAUDE_CODE_TMPDIR` overrides the base.
pub fn spool_root() -> PathBuf {
    spool_root_with(std::env::var("CLAUDE_CODE_TMPDIR").ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn honors_claude_code_tmpdir_override() {
        let root = spool_root_with(Some("/var/cache".into()));
        assert_eq!(root, PathBuf::from("/var/cache").join(claude_dir_name()));
    }

    #[cfg(unix)]
    #[test]
    fn defaults_to_the_literal_tmp_on_unix() {
        let root = spool_root_with(None);
        assert!(root.to_string_lossy().starts_with("/tmp/claude-"));
    }

    #[cfg(unix)]
    #[test]
    fn dir_name_carries_the_real_uid() {
        let output = std::process::Command::new("id").arg("-u").output().unwrap();
        let oracle_uid: u32 = String::from_utf8(output.stdout)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert_eq!(claude_dir_name(), format!("claude-{oracle_uid}"));
    }

    #[cfg(windows)]
    #[test]
    fn dir_name_has_no_uid_segment() {
        assert_eq!(claude_dir_name(), "claude");
    }
}

// PORT STATUS: src/background-tasks/spool-root.ts (15 lines)
// confidence: high
// todos: 0
// notes: `process.getuid()` -> `rustix::process::getuid().as_raw()`, a safe call
// behind `#[cfg(unix)]`; the crate's `forbid(unsafe_code)` ruled out `libc`,
// whose binding needs an unsafe `extern` block. Windows keeps the bare `claude`
// dir name and `std::env::temp_dir()` base, unchanged. `os.tmpdir()` on unix
// stays the literal `/tmp`, matching the shipping CLI (never the process temp
// dir). No fallback uid: `getuid(2)` cannot fail on unix.
