use std::os::unix::process::ExitStatusExt;
use std::process::{ExitStatus, Output};

use super::title_generator::interpret_output;

fn exited(code: i32, stdout: &str, stderr: &str) -> Output {
    Output {
        status: ExitStatus::from_raw(code << 8),
        stdout: stdout.as_bytes().to_vec(),
        stderr: stderr.as_bytes().to_vec(),
    }
}

#[test]
fn a_failed_title_call_reports_stdout_when_stderr_is_empty() {
    let err = interpret_output(
        exited(1, "Not logged in · Please run /login\n", ""),
        "claude",
    )
    .expect_err("exit 1 is an error");
    assert_eq!(
        err.to_string(),
        "claude title generation exited with 1: stdout: Not logged in · Please run /login"
    );
}

#[test]
fn a_failed_title_call_prefers_stderr() {
    let err =
        interpret_output(exited(2, "ignored", "boom"), "claude").expect_err("exit 2 is an error");
    assert_eq!(
        err.to_string(),
        "claude title generation exited with 2: boom"
    );
}

#[test]
fn a_failed_title_call_with_no_output_says_so() {
    let err = interpret_output(exited(1, "", ""), "claude").expect_err("exit 1 is an error");
    assert_eq!(
        err.to_string(),
        "claude title generation exited with 1: <no stderr or stdout>"
    );
}

#[test]
fn a_successful_title_call_returns_the_finalized_title() {
    let title =
        interpret_output(exited(0, "Fix Login Bug\n", ""), "claude").expect("exit 0 succeeds");
    assert_eq!(title.as_deref(), Some("Fix Login Bug"));
}
