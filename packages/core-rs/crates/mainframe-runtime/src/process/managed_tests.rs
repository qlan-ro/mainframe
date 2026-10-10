use super::*;
use std::{process::Stdio, sync::Arc, time::Duration};
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

/// Deadline for runs that must time out: wide enough that a slow `sh` start
/// never lands after it (the output is written well before the deadline).
const TIMEOUT_MARGIN: Duration = Duration::from_secs(3);

#[tokio::test]
async fn prefix_capture_retains_output_on_timeout() {
    let mut command = Command::new("/bin/sh");
    command.args(["-c", "printf output; printf error >&2; exec sleep 60"]);
    let output = run_captured_prefix(command, TIMEOUT_MARGIN, 1024)
        .await
        .unwrap();
    assert!(output.timed_out);
    assert_eq!(output.exit_code, None);
    assert_eq!(output.stdout, b"output");
    assert_eq!(output.stderr, b"error");
}

#[tokio::test]
async fn prefix_capture_closes_stdin_even_when_the_caller_piped_it() {
    let mut command = Command::new("/bin/sh");
    command
        .args(["-c", "cat; printf done"])
        .stdin(Stdio::piped());
    let output = run_captured_prefix(command, Duration::from_secs(10), 1024)
        .await
        .unwrap();
    assert!(!output.timed_out, "cat must see EOF, not a dangling pipe");
    assert_eq!(output.exit_code, Some(0));
    assert_eq!(output.stdout, b"done");
}

#[tokio::test]
async fn prefix_capture_timeout_is_not_extended_by_a_grandchild_holding_the_pipes() {
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("pid");
    let mut command = Command::new("/bin/sh");
    command
        .args([
            "-c",
            "sleep 60 & echo $! > \"$PID_FILE\"; printf output; exec sleep 60",
        ])
        .env("PID_FILE", &pid_file);
    let started = std::time::Instant::now();
    let output = run_captured_prefix(command, Duration::from_secs(2), 1024)
        .await
        .unwrap();
    let elapsed = started.elapsed();
    let grandchild: u32 = tokio::fs::read_to_string(&pid_file)
        .await
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(is_alive(grandchild), "the grandchild keeps the pipes open");
    signal(Target::Pid(grandchild), Signal::Kill).unwrap();
    assert!(output.timed_out);
    assert_eq!(output.stdout, b"output");
    assert!(
        elapsed < Duration::from_secs(6),
        "returned after {elapsed:?}; the reader join must be bounded"
    );
}

#[tokio::test]
async fn exit_latch_fires_only_after_the_pumps_delivered_the_last_chunk() {
    let mut child = Command::new("/bin/sh")
        .args(["-c", "printf hello"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = seen.clone();
    let pump = spawn_chunk_pump(child.stdout.take().unwrap(), move |bytes| {
        sink.lock().unwrap().extend_from_slice(bytes);
        true
    });
    let process = ManagedProcess::spawn(child, vec![pump]);
    let code = tokio::time::timeout(Duration::from_secs(5), process.exit().wait())
        .await
        .unwrap();
    assert_eq!(code, Some(0));
    assert_eq!(seen.lock().unwrap().as_slice(), b"hello");
}
