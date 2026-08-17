//! Red-phase (todo #338, Task 1): pins `spool_root()` and the un-injected
//! production default validator to the daemon's *real* uid instead of the
//! `unwrap_or(0)` stub. Every case here reads the expected uid from an
//! independent oracle (`id -u`), never from the code under test.
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::os::unix::fs::DirBuilderExt;
use std::path::PathBuf;
use std::process::Command;

use mainframe_background_tasks::spool_root::spool_root;
use mainframe_background_tasks::spool_validator::{
    Platform, SpoolValidator, SpoolValidatorDeps, make_spool_validator,
};
use tempfile::TempDir;

fn oracle_uid() -> u32 {
    let output = Command::new("id").arg("-u").output().unwrap();
    String::from_utf8(output.stdout)
        .unwrap()
        .trim()
        .parse()
        .unwrap()
}

fn base_tmp_dir() -> String {
    std::env::var("CLAUDE_CODE_TMPDIR").unwrap_or_else(|_| "/tmp".into())
}

#[tokio::test]
async fn spool_root_uses_the_real_uid() {
    let uid = oracle_uid();
    if uid == 0 {
        // Running as root: `claude-0` is the correct root and this test is meaningless.
        return;
    }

    let base = base_tmp_dir();
    assert_eq!(spool_root(), PathBuf::from(format!("{base}/claude-{uid}")));
}

#[tokio::test]
async fn default_validator_accepts_the_real_uid_root_and_rejects_claude_0() {
    let uid = oracle_uid();
    if uid == 0 {
        // Running as root: `claude-0` is the correct root and this test is meaningless.
        return;
    }

    let base = base_tmp_dir();
    let root = format!("{base}/claude-{uid}");
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&root)
        .unwrap();
    let scratch = TempDir::new_in(&root).unwrap();
    let tasks_dir = scratch.path().join("sess-a").join("tasks");
    std::fs::create_dir_all(&tasks_dir).unwrap();
    let output_path = tasks_dir.join("task-xyz.output");
    std::fs::write(&output_path, b"hello from the real spool root").unwrap();

    // Exactly the production default `routes/background_tasks.rs` builds — no
    // injected uid, no spool-root override.
    let validator = make_spool_validator(SpoolValidatorDeps {
        platform: Platform::current(),
        getuid: None,
        env: std::env::vars().collect(),
        realpath: None,
        tmpdir: None,
    });

    assert!(
        validator
            .validate(&output_path.to_string_lossy(), "task-xyz")
            .await
    );

    // `<base>/claude-0` is never created by this suite, so this must reject
    // both today (nonexistent path) and after the fix (wrong uid segment).
    let rejected_path = format!("{base}/claude-0/p/sess-a/tasks/task-xyz.output");
    assert!(!validator.validate(&rejected_path, "task-xyz").await);
}
