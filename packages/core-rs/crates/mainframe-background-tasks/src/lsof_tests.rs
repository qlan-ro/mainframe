use super::*;
use mainframe_runtime::log_capture::LogCapture;

fn ok_lsof(stdout: &'static str) -> LsofFn {
    Arc::new(move |_path| Box::pin(async move { Ok(stdout.to_string()) }))
}

fn failing_lsof(error: LsofError) -> LsofFn {
    Arc::new(move |_path| {
        let error = error.clone();
        Box::pin(async move { Err(error) })
    })
}

#[cfg(unix)]
fn exited(raw_status: i32, stdout: &str) -> Result<Output, ExecError> {
    use std::os::unix::process::ExitStatusExt as _;
    Ok(Output {
        status: std::process::ExitStatus::from_raw(raw_status),
        stdout: stdout.as_bytes().to_vec(),
        stderr: Vec::new(),
    })
}

#[cfg(unix)]
#[test]
fn exit_codes_zero_and_one_are_answers_and_others_are_failures() {
    assert_eq!(lsof_stdout(exited(0, "p1\n")), Ok("p1\n".to_string()));
    // Exit code 1 means no process has the file open.
    assert_eq!(lsof_stdout(exited(1 << 8, "")), Ok(String::new()));
    assert_eq!(lsof_stdout(exited(2 << 8, "")), Err(LsofError::Exited(2)));
    assert_eq!(lsof_stdout(exited(9, "")), Err(LsofError::Killed));
}

#[test]
fn spawn_failures_map_to_typed_errors() {
    let missing = std::io::Error::from(std::io::ErrorKind::NotFound);
    assert_eq!(
        lsof_stdout(Err(ExecError::Spawn(missing))),
        Err(LsofError::NotInstalled)
    );
    assert_eq!(
        lsof_stdout(Err(ExecError::Timeout)),
        Err(LsofError::TimedOut)
    );
    let denied = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
    assert!(matches!(
        lsof_stdout(Err(ExecError::Spawn(denied))),
        Err(LsofError::Failed(_))
    ));
}

#[tokio::test]
async fn injected_processes_do_not_leak_between_trackers() {
    let first = ProcessDeps::default();
    let second = ProcessDeps::default();
    set_lsof_for_tests(&first, ok_lsof("p11\naw\n"));
    set_lsof_for_tests(&second, ok_lsof("p22\naw\n"));
    let (a, b) = tokio::join!(lsof_writers(&first, "/p"), lsof_writers(&second, "/p"));
    assert_eq!(a, vec![11]);
    assert_eq!(b, vec![22]);
}

#[tokio::test]
async fn keeps_only_write_and_read_write_fds() {
    let process = ProcessDeps::default();
    set_lsof_for_tests(
        &process,
        ok_lsof("p1234\naw\nn/p\np5678\nar\nn/p\np9012\nau\nn/p\n"),
    );
    assert_eq!(
        lsof_writers_detailed(&process, "/p").await,
        Ok(vec![1234, 9012])
    );
}

#[tokio::test]
async fn skips_non_numeric_pids() {
    let process = ProcessDeps::default();
    set_lsof_for_tests(&process, ok_lsof("pabc\naw\nn/p\np42\naw\nn/p\n"));
    assert_eq!(lsof_writers_detailed(&process, "/p").await, Ok(vec![42]));
}

#[tokio::test]
async fn writers_is_empty_when_the_probe_fails() {
    let process = ProcessDeps::default();
    set_lsof_for_tests(&process, failing_lsof(LsofError::TimedOut));
    assert_eq!(lsof_writers(&process, "/p").await, Vec::<u32>::new());
    assert_eq!(
        lsof_writers_detailed(&process, "/p").await,
        Err(LsofError::TimedOut)
    );
}

#[tokio::test]
async fn warns_once_per_tracker_when_lsof_is_missing() {
    let (subscriber, events) = LogCapture::install();
    let _guard = tracing::subscriber::set_default(subscriber);
    let process = ProcessDeps::default();
    set_lsof_for_tests(&process, failing_lsof(LsofError::NotInstalled));
    for _ in 0..3 {
        assert_eq!(
            lsof_writers_detailed(&process, "/p").await,
            Err(LsofError::NotInstalled)
        );
    }
    assert_eq!(
        LogCapture::events_with_reason(&events),
        vec![(tracing::Level::WARN, "lsof_missing".to_string())]
    );
}
