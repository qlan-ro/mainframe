//! The shutdown ladder observed from the server's side: shell scripts record
//! the `exit` notification and SIGTERM as marker files.

use super::*;
use crate::test_fixtures::{assert_pid_gone, bounded, script_manager, timeouts, wait_for};
use std::time::Instant;

fn grace(sigterm_grace: Duration) -> Timeouts {
    Timeouts {
        sigterm_grace,
        ..timeouts()
    }
}

#[tokio::test]
async fn a_server_that_honours_exit_needs_no_signal() {
    let dir = tempfile::tempdir().unwrap();
    // Copies stdin to a file and exits once the `exit` notification lands.
    let script = format!(
        "cd {}; trap 'touch term; exit 1' TERM; exec 3<&0; cat <&3 >input 2>/dev/null & \
         until grep -q '\"method\":\"exit\"' input 2>/dev/null; do sleep 0.02; done",
        dir.path().display()
    );
    // The exit window covers the script's poll, `grep` and exit under load.
    let timeouts = Timeouts {
        shutdown_exit: Duration::from_secs(2),
        ..grace(Duration::from_secs(5))
    };
    let manager = script_manager(&script, timeouts);
    let handle = manager.get_or_spawn("p1", "typescript").await.unwrap();

    bounded(manager.shutdown("p1", "typescript")).await;

    assert!(handle.exited());
    assert!(!dir.path().join("term").exists());
    let input = std::fs::read_to_string(dir.path().join("input")).unwrap();
    assert!(input.contains(r#""method":"shutdown""#), "{input}");
}

#[tokio::test]
async fn a_server_that_ignores_the_handshake_gets_sigterm() {
    let dir = tempfile::tempdir().unwrap();
    let script = format!(
        "cd {}; trap 'touch term; exit 0' TERM; touch ready; while :; do sleep 0.02; done",
        dir.path().display()
    );
    let manager = script_manager(&script, grace(Duration::from_secs(5)));
    let handle = manager.get_or_spawn("p1", "typescript").await.unwrap();
    wait_for("the TERM trap", || dir.path().join("ready").exists()).await;
    let started = Instant::now();

    bounded(manager.shutdown("p1", "typescript")).await;

    assert!(dir.path().join("term").exists());
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "the server exited on SIGTERM, so the grace must not run out"
    );
    assert!(manager.get_handle("p1", "typescript").is_none());
    assert_pid_gone(handle.pid).await;
}

#[tokio::test]
async fn a_server_that_ignores_sigterm_is_killed() {
    let dir = tempfile::tempdir().unwrap();
    let script = format!(
        "cd {}; trap 'touch term' TERM; touch ready; while :; do sleep 0.02; done",
        dir.path().display()
    );
    let manager = script_manager(&script, grace(Duration::from_millis(300)));
    let handle = manager.get_or_spawn("p1", "typescript").await.unwrap();
    wait_for("the TERM trap", || dir.path().join("ready").exists()).await;
    let started = Instant::now();

    bounded(manager.shutdown("p1", "typescript")).await;

    assert!(dir.path().join("term").exists());
    assert!(started.elapsed() >= Duration::from_millis(300));
    assert!(handle.exited());
    assert_pid_gone(handle.pid).await;
}

#[tokio::test]
async fn shutdown_all_runs_the_grace_periods_concurrently() {
    let dir = tempfile::tempdir().unwrap();
    let script = format!(
        "trap '' TERM; touch {}/$$; exec sleep 100",
        dir.path().display()
    );
    let manager = script_manager(&script, grace(Duration::from_millis(1_500)));
    let first = manager.get_or_spawn("p1", "typescript").await.unwrap();
    let second = manager.get_or_spawn("p1", "python").await.unwrap();
    wait_for("both TERM traps", || {
        [first.pid, second.pid]
            .iter()
            .all(|pid| dir.path().join(pid.to_string()).exists())
    })
    .await;
    let started = Instant::now();

    bounded(manager.shutdown_all()).await;

    // One after the other, the two grace periods alone take 3s.
    assert!(started.elapsed() < Duration::from_millis(2_800));
    assert_pid_gone(first.pid).await;
    assert_pid_gone(second.pid).await;
}

#[tokio::test]
async fn a_full_stdin_queue_does_not_hold_the_shutdown() {
    // `sleep` never reads stdin, so the pipe fills, the writer task blocks
    // and the bounded queue stays full: a handshake that waited for queue
    // room would never reach the signals.
    let manager = script_manager("exec sleep 100", grace(Duration::from_secs(5)));
    let handle = manager.get_or_spawn("p1", "typescript").await.unwrap();
    handle.try_write(&"x".repeat(1 << 20)).unwrap();
    let mut queued = 1;
    while handle.try_write("x").is_ok() {
        queued += 1;
        assert!(queued <= 4096, "the stdin queue never filled");
    }

    tokio::time::timeout(Duration::from_secs(2), manager.shutdown("p1", "typescript"))
        .await
        .expect("shutdown must not wait for stdin queue room");

    assert!(handle.exited());
    assert_pid_gone(handle.pid).await;
}
