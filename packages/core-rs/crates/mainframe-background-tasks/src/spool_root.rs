//! Where the Claude CLI spools background-task output, and the check that a
//! path really lies inside it.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// The CLI names its per-user temp dir after the real uid. `getuid(2)`
/// cannot fail.
#[cfg(unix)]
fn claude_dir_name() -> String {
    format!("claude-{}", rustix::process::getuid().as_raw())
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

/// Whether `output_path` names `<task_id>.output` inside a `tasks` directory
/// under the spool root once symlinks are resolved. The output route reads
/// only paths that pass, so a task record cannot point the daemon at an
/// arbitrary file.
pub async fn is_spool_task_output(output_path: &Path, task_id: &str) -> bool {
    is_task_output_under(&spool_root(), output_path, task_id).await
}

/// Only the root's parent is resolved, not the root itself, so a
/// `claude-<uid>` symlink planted in a shared temp dir cannot move the root
/// somewhere else.
pub(crate) async fn is_task_output_under(root: &Path, output_path: &Path, task_id: &str) -> bool {
    let expected_name = format!("{task_id}.output");
    if output_path.file_name() != Some(OsStr::new(&expected_name)) {
        return false;
    }
    let (Some(base), Some(root_name)) = (root.parent(), root.file_name()) else {
        return false;
    };
    let (Ok(base), Ok(resolved)) = (
        tokio::fs::canonicalize(base).await,
        tokio::fs::canonicalize(output_path).await,
    ) else {
        return false;
    };
    resolved
        .strip_prefix(base.join(root_name))
        .is_ok_and(|inside| inside.components().any(|part| part.as_os_str() == "tasks"))
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

#[cfg(test)]
#[path = "spool_root_tests.rs"]
mod output_path_tests;
