//! `generate_claude_title` exit-status handling (#287).
//!
//! Drives a real stub `/bin/sh` executable as the title binary so these cases
//! exercise the CLI's actual exit code and stderr, not a mocked `Command`.
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::os::unix::fs::PermissionsExt;

use mainframe_adapter_claude::title_generator::generate_claude_title;
use tempfile::tempdir;
use tokio::sync::Mutex;

/// Serializes writing a stub and running it, across every test in this binary.
///
/// These tests run on separate threads. A spawn forks the whole process, so the
/// child inherits any write fd another test happens to have open on its own
/// stub — and that test's exec then fails with ETXTBSY ("Text file busy").
/// Holding this for the whole write-then-run keeps the two from overlapping.
static STUB_EXEC: Mutex<()> = Mutex::const_new(());

fn write_stub(dir: &std::path::Path, name: &str, script: &str) -> String {
    let path = dir.join(name);
    fs::write(&path, script).unwrap();
    let mut perms = fs::metadata(&path).unwrap().permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&path, perms).unwrap();
    path.to_str().unwrap().to_string()
}

#[tokio::test]
async fn nonzero_exit_surfaces_the_status_and_the_cli_stderr() {
    let _guard = STUB_EXEC.lock().await;
    let dir = tempdir().unwrap();
    let binary = write_stub(
        dir.path(),
        "claude",
        "#!/bin/sh\nprintf 'Invalid API key · Please run /login\\n' >&2\nexit 1\n",
    );

    let err = generate_claude_title("first message", &binary, "/usr/bin:/bin")
        .await
        .expect_err("non-zero exit must be an error, not an empty success");

    let text = err.to_string();
    assert!(text.contains('1'), "expected the exit code in: {text}");
    assert!(
        text.contains("Invalid API key"),
        "expected the CLI stderr in: {text}"
    );
}

#[tokio::test]
async fn chatty_stderr_is_truncated_at_the_character_cap() {
    let _guard = STUB_EXEC.lock().await;
    let dir = tempdir().unwrap();
    let noisy = "é".repeat(64 * 1024 / "é".len());
    let script = format!(
        "#!/bin/sh\nprintf 'HEAD-MARKER' >&2\nprintf '{noisy}' >&2\nprintf 'TAIL-MARKER' >&2\nexit 1\n"
    );
    let binary = write_stub(dir.path(), "claude", &script);

    let err = generate_claude_title("first message", &binary, "/usr/bin:/bin")
        .await
        .expect_err("non-zero exit must be an error");

    let text = err.to_string();
    assert!(text.contains("HEAD-MARKER"), "missing head marker: {text}");
    assert!(
        !text.contains("TAIL-MARKER"),
        "stderr was not truncated: {text}"
    );
    assert!(text.contains('…'), "missing truncation marker: {text}");
    assert!(
        text.chars().count() < 1200,
        "error text not bounded: {} chars",
        text.chars().count()
    );
    assert!(
        !text.contains('\u{FFFD}'),
        "truncation split a multibyte character: {text}"
    );
}

#[tokio::test]
async fn zero_exit_with_unusable_stdout_is_still_ok_none() {
    let _guard = STUB_EXEC.lock().await;
    let dir = tempdir().unwrap();
    let binary = write_stub(dir.path(), "claude", "#!/bin/sh\nprintf 'a\\n'\n");

    let result = generate_claude_title("first message", &binary, "/usr/bin:/bin").await;

    assert_eq!(result.unwrap(), None);
}

#[tokio::test]
async fn spawn_failure_names_the_binary() {
    let _guard = STUB_EXEC.lock().await;
    let dir = tempdir().unwrap();
    let missing = dir
        .path()
        .join("does-not-exist")
        .to_str()
        .unwrap()
        .to_string();

    let err = generate_claude_title("first message", &missing, "/usr/bin:/bin")
        .await
        .expect_err("spawning a missing binary must be an error");

    assert!(
        err.to_string().contains(&missing),
        "expected the binary path in: {err}"
    );
}
