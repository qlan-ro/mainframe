use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

fn ok_exec(stdout: &'static str) -> ExecFn {
    Arc::new(move |_cmd, _args| {
        Box::pin(async move {
            Ok(ExecOk {
                stdout: stdout.to_string(),
            })
        }) as ExecFuture
    })
}

fn fail_exec(err: LsofExecError) -> ExecFn {
    Arc::new(move |_cmd, _args| {
        let err = err.clone();
        Box::pin(async move { Err(err) }) as ExecFuture
    })
}

mod cases_0;

#[tokio::test]
async fn injected_processes_do_not_leak_between_trackers() {
    let first = crate::process::ProcessDeps::default();
    let second = crate::process::ProcessDeps::default();
    set_exec_for_tests(&first, ok_exec("p11\naw\n"));
    set_exec_for_tests(&second, ok_exec("p22\naw\n"));
    let (a, b) = tokio::join!(lsof_writers(&first, "/p"), lsof_writers(&second, "/p"));
    assert_eq!(a, vec![11]);
    assert_eq!(b, vec![22]);
}
