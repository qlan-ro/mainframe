use super::*;
use std::{process::Stdio, time::Duration};
use tokio::process::Command;

fn script(script: &str) -> Command {
    let mut command = Command::new("/bin/sh");
    command.args(["-c", script]).stdin(Stdio::null());
    command
}

#[tokio::test]
async fn captures_both_streams_and_nonzero_status() {
    let output = run_captured(script("printf output; printf error >&2; exit 7"), None)
        .await
        .unwrap();
    assert_eq!(output.stdout, b"output");
    assert_eq!(output.stderr, b"error");
    assert_eq!(output.status.code(), Some(7));
}

#[tokio::test]
async fn each_stream_has_its_own_limit() {
    let output = run_captured_limited(script("printf abcd; printf efgh >&2"), None, 4)
        .await
        .unwrap();
    assert_eq!(output.stdout, b"abcd");
    assert_eq!(output.stderr, b"efgh");
    assert!(matches!(
        run_captured_limited(script("printf abcde"), None, 4).await,
        Err(ExecError::OutputLimit)
    ));
}

/// Deadline for runs that must time out: wide enough that a slow `sh` start
/// never lands after it (the pid file is written before the deadline fires).
const TIMEOUT_MARGIN: Duration = Duration::from_secs(3);

#[tokio::test]
async fn timeout_kills_and_reaps_child() {
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("pid");
    let mut command = script("echo $$ > \"$PID_FILE\"; exec sleep 60");
    command.env("PID_FILE", &pid_file);
    assert!(matches!(
        run_captured(command, Some(TIMEOUT_MARGIN)).await,
        Err(ExecError::Timeout)
    ));
    let pid = tokio::fs::read_to_string(pid_file)
        .await
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(
        !is_alive(pid),
        "reaped child must no longer have a process table entry"
    );
}

#[tokio::test]
async fn cancellation_kills_and_reaps_child() {
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("pid");
    let mut command = script("echo $$ > \"$PID_FILE\"; exec sleep 60");
    command.env("PID_FILE", &pid_file);
    let run = tokio::spawn(run_captured(command, None));
    let pid = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let Ok(value) = tokio::fs::read_to_string(&pid_file).await
                && let Ok(pid) = value.trim().parse::<u32>()
            {
                break pid;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    run.abort();
    assert!(run.await.unwrap_err().is_cancelled());
    tokio::time::timeout(Duration::from_secs(3), async {
        while is_alive(pid) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("cancelled child must be killed and reaped");
}

#[test]
fn invalid_ids_cannot_signal_the_current_group() {
    for target in [Target::Pid(0), Target::Group(0), Target::Pid(u32::MAX)] {
        assert_eq!(
            signal(target, Signal::Term).unwrap_err().kind(),
            std::io::ErrorKind::InvalidInput
        );
    }
}

#[tokio::test]
async fn stdin_queue_rejects_writes_past_capacity_without_buffering() {
    let (writer, mut queue) = StdinWriter::channel(1);
    assert_eq!(writer.try_write(b"one".to_vec()), Ok(()));
    assert_eq!(
        writer.try_write(b"two".to_vec()),
        Err(StdinWriteError::Full)
    );
    assert_eq!(queue.recv().await.as_deref(), Some(&b"one"[..]));
    assert_eq!(writer.try_write(b"three".to_vec()), Ok(()));
    assert_eq!(queue.recv().await.as_deref(), Some(&b"three"[..]));
}

#[tokio::test]
async fn async_stdin_write_waits_for_room_and_reports_a_closed_queue() {
    let (writer, mut queue) = StdinWriter::channel(1);
    writer.write(b"one".to_vec()).await.unwrap();
    let blocked = tokio::spawn({
        let writer = writer.clone();
        async move { writer.write(b"two".to_vec()).await }
    });
    assert_eq!(queue.recv().await.as_deref(), Some(&b"one"[..]));
    assert_eq!(blocked.await.unwrap(), Ok(()));
    assert_eq!(queue.recv().await.as_deref(), Some(&b"two"[..]));
    drop(queue);
    assert!(writer.is_closed());
    assert_eq!(
        writer.write(b"three".to_vec()).await,
        Err(StdinWriteError::Closed)
    );
    assert_eq!(
        writer.try_write(b"four".to_vec()),
        Err(StdinWriteError::Closed)
    );
}

#[tokio::test]
async fn a_background_job_holding_the_pipes_does_not_hold_the_result() {
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        run_captured(script("printf done; sleep 30 &"), None),
    )
    .await
    .expect("the run must end with the shell, not with the background job")
    .unwrap();
    assert_eq!(output.stdout, b"done");
    assert_eq!(output.status.code(), Some(0));
}

#[tokio::test]
async fn a_background_job_survives_writing_after_the_run_ended() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("survived");
    let mut command = script("(sleep 1; echo late; echo ok > \"$MARKER\") & printf started");
    command.env("MARKER", &marker);
    let output = run_captured(command, None).await.unwrap();
    assert_eq!(output.stdout, b"started");
    crate::test_support::poll_until(
        Duration::from_secs(5),
        Duration::from_millis(20),
        async || marker.exists(),
    )
    .await
    .expect("the job must not die on a closed pipe");
}

#[tokio::test]
async fn an_exit_before_the_deadline_is_not_a_timeout_when_a_job_holds_the_pipes() {
    let command = script("sleep 30 & exit 3");
    let output = run_captured_prefix(command, Duration::from_millis(200), 1024)
        .await
        .unwrap();
    assert!(!output.timed_out);
    assert_eq!(output.exit_code, Some(3));
}

#[tokio::test]
async fn prefix_capture_lets_a_chatty_child_finish_and_keeps_exactly_the_limit() {
    let command = script("exec head -c 1000000 /dev/zero");
    let output = run_captured_prefix(command, TIMEOUT_MARGIN, 1024)
        .await
        .unwrap();
    assert_eq!(output.exit_code, Some(0), "the child must not die on EPIPE");
    assert_eq!(output.stdout.len(), 1024);
    assert!(!output.timed_out);
}

#[tokio::test]
async fn prefix_capture_keeps_output_read_before_the_deadline() {
    let command = script("printf partial; exec sleep 60");
    let output = run_captured_prefix(command, Duration::from_millis(500), 1024)
        .await
        .unwrap();
    assert_eq!(output.stdout, b"partial");
    assert!(output.timed_out);
    assert_eq!(output.exit_code, None);
}

async fn pumped_lines(input: &'static [u8]) -> Vec<String> {
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    spawn_line_pump(input, move |line| {
        sender.send(line).unwrap();
    })
    .await
    .unwrap();
    let mut lines = Vec::new();
    while let Some(line) = receiver.recv().await {
        lines.push(line);
    }
    lines
}

#[tokio::test]
async fn line_pump_survives_invalid_utf8() {
    assert_eq!(
        pumped_lines(b"ok\n\xff\nafter\n").await,
        ["ok", "\u{fffd}", "after"]
    );
}

#[tokio::test]
async fn line_pump_strips_line_endings_and_keeps_an_unterminated_last_line() {
    assert_eq!(pumped_lines(b"a\r\nb\n\nc").await, ["a", "b", "", "c"]);
}
