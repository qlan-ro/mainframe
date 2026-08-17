//! Moved verbatim from `src/spool_validator.rs`'s inline `#[cfg(test)] mod
//! tests` (todo #338, Task 8) — that file crossed the 300-line limit once the
//! uid-default fix landed. No assertion changed.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
use std::sync::Arc;

use mainframe_background_tasks::spool_validator::{
    Platform, RealpathFn, SpoolValidator, SpoolValidatorDeps, make_spool_validator,
};

fn identity_realpath() -> RealpathFn {
    Arc::new(|p: String| Box::pin(async move { Ok(p) }))
}

fn empty_env() -> HashMap<String, String> {
    HashMap::new()
}

// --- makeSpoolValidator (linux) ---

#[tokio::test]
async fn accepts_a_well_formed_spool_path() {
    let v = make_spool_validator(SpoolValidatorDeps {
        platform: Platform::Linux,
        getuid: Some(Arc::new(|| 501)),
        env: empty_env(),
        realpath: Some(identity_realpath()),
        tmpdir: None,
    });
    assert!(
        v.validate(
            "/tmp/claude-501/project-slug/session-abc/tasks/task-xyz.output",
            "task-xyz"
        )
        .await
    );
}

#[tokio::test]
async fn rejects_basename_mismatch() {
    let v = make_spool_validator(SpoolValidatorDeps {
        platform: Platform::Linux,
        getuid: Some(Arc::new(|| 501)),
        env: empty_env(),
        realpath: Some(identity_realpath()),
        tmpdir: None,
    });
    assert!(
        !v.validate(
            "/tmp/claude-501/project-slug/session-abc/tasks/other.output",
            "task-xyz"
        )
        .await
    );
}

#[tokio::test]
async fn rejects_path_outside_spool_root() {
    let v = make_spool_validator(SpoolValidatorDeps {
        platform: Platform::Linux,
        getuid: Some(Arc::new(|| 501)),
        env: empty_env(),
        realpath: Some(identity_realpath()),
        tmpdir: None,
    });
    assert!(!v.validate("/etc/passwd", "task-xyz").await);
}

#[tokio::test]
async fn rejects_path_missing_tasks_segment() {
    let v = make_spool_validator(SpoolValidatorDeps {
        platform: Platform::Linux,
        getuid: Some(Arc::new(|| 501)),
        env: empty_env(),
        realpath: Some(identity_realpath()),
        tmpdir: None,
    });
    assert!(
        !v.validate(
            "/tmp/claude-501/project-slug/session-abc/task-xyz.output",
            "task-xyz"
        )
        .await
    );
}

#[tokio::test]
async fn rejects_when_realpath_escapes_the_root() {
    let realpath: RealpathFn = Arc::new(|p: String| {
        Box::pin(async move {
            if p == "/tmp/claude-501/project/s/tasks/task-xyz.output" {
                Ok("/etc/passwd".to_string())
            } else {
                Ok(p)
            }
        })
    });
    let v = make_spool_validator(SpoolValidatorDeps {
        platform: Platform::Linux,
        getuid: Some(Arc::new(|| 501)),
        env: empty_env(),
        realpath: Some(realpath),
        tmpdir: None,
    });
    assert!(
        !v.validate(
            "/tmp/claude-501/project/s/tasks/task-xyz.output",
            "task-xyz"
        )
        .await
    );
}

// --- makeSpoolValidator (macos /private/tmp symlink) ---

#[tokio::test]
async fn accepts_when_tmp_realpaths_to_private_tmp() {
    let realpath: RealpathFn = Arc::new(|p: String| {
        Box::pin(async move {
            Ok(if let Some(rest) = p.strip_prefix("/tmp") {
                format!("/private/tmp{rest}")
            } else {
                p
            })
        })
    });
    let v = make_spool_validator(SpoolValidatorDeps {
        platform: Platform::Darwin,
        getuid: Some(Arc::new(|| 501)),
        env: empty_env(),
        realpath: Some(realpath),
        tmpdir: None,
    });
    assert!(
        v.validate(
            "/private/tmp/claude-501/p/s/tasks/task-xyz.output",
            "task-xyz"
        )
        .await
    );
}

// --- makeSpoolValidator (windows) ---

fn win_validator() -> impl SpoolValidator {
    let tmpdir = "C:\\Users\\me\\AppData\\Local\\Temp";
    make_spool_validator(SpoolValidatorDeps {
        platform: Platform::Win32,
        getuid: None,
        env: empty_env(),
        realpath: Some(identity_realpath()),
        tmpdir: Some(Arc::new(move || tmpdir.to_string())),
    })
}

#[tokio::test]
async fn uses_claude_no_uid_suffix_as_the_dir_name() {
    let v = win_validator();
    assert!(
        v.validate(
            "C:\\Users\\me\\AppData\\Local\\Temp\\claude\\proj\\sess\\tasks\\task-xyz.output",
            "task-xyz"
        )
        .await
    );
}

#[tokio::test]
async fn rejects_a_unix_style_claude_501_path_on_windows() {
    let v = win_validator();
    assert!(
        !v.validate(
            "C:\\Users\\me\\AppData\\Local\\Temp\\claude-501\\proj\\sess\\tasks\\task-xyz.output",
            "task-xyz"
        )
        .await
    );
}

// --- makeSpoolValidator (CLAUDE_CODE_TMPDIR override) ---

#[tokio::test]
async fn honors_claude_code_tmpdir_env_var() {
    let mut env = HashMap::new();
    env.insert("CLAUDE_CODE_TMPDIR".to_string(), "/var/cache".to_string());
    let v = make_spool_validator(SpoolValidatorDeps {
        platform: Platform::Linux,
        getuid: Some(Arc::new(|| 501)),
        env,
        realpath: Some(identity_realpath()),
        tmpdir: None,
    });
    assert!(
        v.validate(
            "/var/cache/claude-501/p/s/tasks/task-xyz.output",
            "task-xyz"
        )
        .await
    );
}
