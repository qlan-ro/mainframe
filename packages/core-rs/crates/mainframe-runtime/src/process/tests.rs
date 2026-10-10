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

#[tokio::test]
async fn timeout_kills_and_reaps_child() {
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("pid");
    let mut command = script("echo $$ > \"$PID_FILE\"; exec sleep 60");
    command.env("PID_FILE", &pid_file);
    assert!(matches!(
        run_captured(command, Some(Duration::from_millis(300))).await,
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
            if let Ok(value) = tokio::fs::read_to_string(&pid_file).await {
                if let Ok(pid) = value.trim().parse::<u32>() {
                    break pid;
                }
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
