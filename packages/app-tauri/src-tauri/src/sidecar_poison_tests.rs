use super::*;

#[test]
fn poisoned_child_lock_still_allows_stop_to_clear_the_slot() {
    let child = Command::new(std::env::current_exe().unwrap())
        .arg("--help")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let expected_pid = child.id();
    let handle = DaemonHandle {
        child: Arc::new(Mutex::new(Some(child))),
    };
    std::thread::scope(|scope| {
        assert!(scope
            .spawn(|| {
                let _guard = handle.child.lock().unwrap();
                panic!("poison sidecar child slot");
            })
            .join()
            .is_err());
    });

    assert_eq!(handle.pid(), Some(expected_pid));
    handle.stop();
    assert_eq!(handle.pid(), None);
}
