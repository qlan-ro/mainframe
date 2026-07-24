//! Black-box coverage for `mainframe status`/`mainframe pair`'s connect-failure
//! path: spawns the real compiled binary (not the in-process fn) against a port
//! nothing is listening on, so `process::exit(1)` actually runs — a path unit
//! tests can't cover in-process without killing the test runner.
//!
//! Integration tests are only built under `cargo test`, so `unwrap`/`expect` are
//! permitted here (RUST RULES `#[cfg(test)]` exemption).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::process::Command;

/// Binds an ephemeral port and releases it immediately, handing back a port
/// number nothing is listening on (safe stand-in for a dead daemon) without
/// ever touching a real Mainframe port.
fn unused_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap().port()
}

fn run_subcommand(subcommand: &str) -> std::process::Output {
    let data_dir = tempfile::tempdir().unwrap();
    Command::new(env!("CARGO_BIN_EXE_mainframe-daemon"))
        .arg(subcommand)
        .env("DAEMON_PORT", unused_port().to_string())
        .env("MAINFRAME_DATA_DIR", data_dir.path())
        .output()
        .expect("failed to spawn mainframe-daemon")
}

#[test]
fn status_exits_1_with_a_connect_failure_message_when_no_daemon_is_listening() {
    let output = run_subcommand("status");
    assert!(
        !output.status.success(),
        "expected a non-zero exit, got {:?}",
        output.status
    );
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("Cannot reach daemon at"),
        "stderr was: {stderr}"
    );
    assert!(stderr.contains("Is it running?"), "stderr was: {stderr}");
}

#[test]
fn pair_exits_1_with_a_connect_failure_message_when_no_daemon_is_listening() {
    let output = run_subcommand("pair");
    assert!(
        !output.status.success(),
        "expected a non-zero exit, got {:?}",
        output.status
    );
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("Cannot reach daemon at"),
        "stderr was: {stderr}"
    );
    assert!(stderr.contains("Is it running?"), "stderr was: {stderr}");
}
