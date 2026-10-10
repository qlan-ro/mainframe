use super::*;
use std::{process::Stdio, time::Duration};
use tokio::process::Command;

#[tokio::test]
async fn dropping_last_owner_kills_and_reaps() {
    let child = Command::new("/bin/sleep")
        .arg("60")
        .stdin(Stdio::null())
        .spawn()
        .unwrap();
    let pid = child.id().unwrap();
    let process = ManagedProcess::spawn(child, Vec::new());
    let exit = process.exit();
    let other = process.clone();
    drop(process);
    assert!(!exit.exited());
    drop(other);
    tokio::time::timeout(Duration::from_secs(3), exit.wait())
        .await
        .unwrap();
    assert!(exit.exited());
    assert!(!is_alive(pid));
}

#[tokio::test(start_paused = true)]
async fn escalation_orders_term_then_kill_and_reports_survivor() {
    let mut signals = Vec::new();
    let result = terminate_with(
        |kind| {
            signals.push(kind);
            Ok(())
        },
        Duration::from_secs(1),
        std::future::pending(),
    )
    .await
    .unwrap();
    assert_eq!(signals, vec![Signal::Term, Signal::Kill]);
    assert_eq!(result, Terminated::StillRunning);
}

#[tokio::test(start_paused = true)]
async fn completed_exit_does_not_escalate() {
    let mut signals = Vec::new();
    let result = terminate_with(
        |kind| {
            signals.push(kind);
            Ok(())
        },
        Duration::from_secs(1),
        async {},
    )
    .await
    .unwrap();
    assert_eq!(signals, vec![Signal::Term]);
    assert_eq!(result, Terminated::Exited);
}

#[test]
fn tails_retain_exact_line_order_and_accept_zero_capacity() {
    let mut tail = TailBuffer::new(2);
    for line in ["first", "second", "third"] {
        tail.push(line.to_string());
    }
    assert_eq!(
        tail.iter().map(String::as_str).collect::<Vec<_>>(),
        vec!["second", "third"]
    );
    let mut empty = TailBuffer::new(0);
    empty.push("discarded".to_string());
    assert!(empty.is_empty());
}

#[tokio::test]
async fn prefix_capture_retains_output_on_timeout() {
    let mut command = Command::new("/bin/sh");
    command.args(["-c", "printf output; printf error >&2; exec sleep 60"]);
    let output = run_captured_prefix(command, Duration::from_millis(300), 1024)
        .await
        .unwrap();
    assert!(output.timed_out);
    assert_eq!(output.exit_code, None);
    assert_eq!(output.stdout, b"output");
    assert_eq!(output.stderr, b"error");
}
