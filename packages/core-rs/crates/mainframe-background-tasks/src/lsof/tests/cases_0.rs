use super::*;

#[tokio::test]
async fn parses_write_mode_fds_only() {
    let process = crate::process::ProcessDeps::default();
    set_exec_for_tests(
        &process,
        ok_exec("p1234\naw\nn/p\np5678\nar\nn/p\np9012\nau\nn/p\n"),
    );
    assert_eq!(
        lsof_writers_detailed(&process, "/p").await,
        Ok(vec![1234, 9012])
    );
}

#[tokio::test]
async fn exit_code_1_is_ok_empty() {
    let process = crate::process::ProcessDeps::default();
    set_exec_for_tests(
        &process,
        fail_exec(LsofExecError {
            code: Some(ExecCode::Number(1)),
            signal: None,
            stdout: Some(String::new()),
        }),
    );
    assert_eq!(lsof_writers_detailed(&process, "/p").await, Ok(vec![]));
}

#[tokio::test]
async fn enoent_is_not_ok() {
    let process = crate::process::ProcessDeps::default();
    set_exec_for_tests(
        &process,
        fail_exec(LsofExecError {
            code: Some(ExecCode::Text("ENOENT".to_string())),
            signal: None,
            stdout: None,
        }),
    );
    let r = lsof_writers_detailed(&process, "/p").await;
    assert!(r.is_err());
    assert!(r.unwrap_err().to_lowercase().contains("lsof"));
}

#[tokio::test]
async fn exit_code_2_is_not_ok() {
    let process = crate::process::ProcessDeps::default();
    set_exec_for_tests(
        &process,
        fail_exec(LsofExecError {
            code: Some(ExecCode::Number(2)),
            signal: None,
            stdout: None,
        }),
    );
    assert!(lsof_writers_detailed(&process, "/p").await.is_err());
}

#[tokio::test]
async fn timeout_signal_is_not_ok() {
    let process = crate::process::ProcessDeps::default();
    set_exec_for_tests(
        &process,
        fail_exec(LsofExecError {
            code: None,
            signal: Some("SIGTERM".to_string()),
            stdout: None,
        }),
    );
    assert!(lsof_writers_detailed(&process, "/p").await.is_err());
}

#[tokio::test]
async fn rejects_non_numeric_pids_defensively() {
    let process = crate::process::ProcessDeps::default();
    set_exec_for_tests(&process, ok_exec("pabc\naw\nn/p\np42\naw\nn/p\n"));
    assert_eq!(lsof_writers_detailed(&process, "/p").await, Ok(vec![42]));
}

#[tokio::test]
async fn writers_returns_empty_when_unavailable() {
    let process = crate::process::ProcessDeps::default();
    set_exec_for_tests(
        &process,
        fail_exec(LsofExecError {
            code: Some(ExecCode::Text("ENOENT".to_string())),
            signal: None,
            stdout: None,
        }),
    );
    assert_eq!(lsof_writers(&process, "/p").await, Vec::<u32>::new());
}

#[tokio::test]
async fn writers_returns_pids_on_success() {
    let process = crate::process::ProcessDeps::default();
    set_exec_for_tests(&process, ok_exec("p7\naw\nn/p\n"));
    assert_eq!(lsof_writers(&process, "/p").await, vec![7]);
}

#[tokio::test]
async fn any_returns_pids_regardless_of_access_mode() {
    let process = crate::process::ProcessDeps::default();
    set_exec_for_tests(&process, ok_exec("p1\nar\nn/p\np2\naw\nn/p\n"));
    assert_eq!(lsof_any(&process, "/p").await, vec![1, 2]);
}

#[tokio::test]
async fn only_logs_warn_once_across_repeated_enoent_calls() {
    let process = crate::process::ProcessDeps::default();
    set_exec_for_tests(
        &process,
        fail_exec(LsofExecError {
            code: Some(ExecCode::Text("ENOENT".to_string())),
            signal: None,
            stdout: None,
        }),
    ); // also resets warned_missing
    let count = Arc::new(AtomicUsize::new(0));
    let count2 = count.clone();
    set_logger_for_tests(
        &process,
        Arc::new(move |_msg: &str| {
            count2.fetch_add(1, Ordering::SeqCst);
        }),
    );
    let r1 = lsof_writers_detailed(&process, "/p").await;
    let r2 = lsof_writers_detailed(&process, "/p").await;
    assert!(r1.is_err());
    assert!(r2.is_err());
    assert_eq!(count.load(Ordering::SeqCst), 1);
    // Restore the default logger so later tests don't inherit the counter.
    set_logger_for_tests(&process, default_logger());
}
