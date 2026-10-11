use super::*;
use std::io;

#[test]
fn signals_every_pid_in_the_tree_even_when_one_fails() {
    let attempted = Arc::new(Mutex::new(Vec::new()));
    let log = attempted.clone();
    let result = os::signal_each(&[100, 200, 300], move |pid| {
        log.lock_recover().push(pid);
        if pid == 200 {
            Err(io::Error::from_raw_os_error(1)) // EPERM
        } else {
            Ok(())
        }
    });
    assert_eq!(*attempted.lock_recover(), vec![100, 200, 300]);
    let error = result.unwrap_err();
    assert!(!error.root_failed);
    assert!(error.detail.starts_with("pid 200: "), "{error}");
    assert!(!error.detail.contains("pid 100"), "{error}");
    assert!(!error.detail.contains("pid 300"), "{error}");
}

#[test]
fn flags_a_failure_of_the_root_pid() {
    let result = os::signal_each(&[100, 200], |pid| {
        if pid == 100 {
            Err(io::Error::from_raw_os_error(1)) // EPERM
        } else {
            Ok(())
        }
    });
    let error = result.unwrap_err();
    assert!(error.root_failed);
    assert!(error.detail.starts_with("pid 100: "), "{error}");
}

#[test]
fn reports_ok_when_every_pid_was_signalled() {
    assert_eq!(os::signal_each(&[1, 2], |_| Ok(())), Ok(()));
}
