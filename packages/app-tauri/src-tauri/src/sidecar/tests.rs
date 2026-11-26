use super::*;

#[cfg(unix)]
fn spawn_sh(script: &str) -> Child {
    Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .spawn()
        .unwrap()
}

#[cfg(unix)]
#[test]
fn stop_child_lets_a_daemon_exit_on_sigterm() {
    use std::os::unix::process::ExitStatusExt;
    let child = spawn_sh("exec sleep 100");

    let status = stop_child(
        &DaemonHandle::new(Some(child)).child,
        Duration::from_secs(10),
        Duration::from_millis(10),
    )
    .unwrap()
    .unwrap();

    assert_eq!(status.signal(), Some(15));
}

#[cfg(unix)]
#[test]
fn stop_child_kills_a_daemon_that_outlives_the_grace() {
    use std::os::unix::process::ExitStatusExt;
    let dir = std::env::temp_dir().join(format!("mf-stop-child-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let marker = dir.join("trapped");
    let child = spawn_sh(&format!(
        "trap '' TERM; touch {}; exec sleep 100",
        marker.display()
    ));
    let deadline = Instant::now() + Duration::from_secs(5);
    while !marker.exists() {
        assert!(
            Instant::now() < deadline,
            "the child never installed its trap"
        );
        std::thread::sleep(Duration::from_millis(10));
    }

    let status = stop_child(
        &DaemonHandle::new(Some(child)).child,
        Duration::from_millis(200),
        Duration::from_millis(10),
    )
    .unwrap()
    .unwrap();

    assert_eq!(status.signal(), Some(9));
    let _ = std::fs::remove_dir_all(&dir);
}

/// The Rust daemon scan finds `mainframe-daemon[-triple]`, ignores zero-byte
/// placeholders, and stays disjoint from a sibling `node` binary.
#[test]
fn bundled_rust_daemon_scan() {
    use std::io::Write;
    let dir = std::env::temp_dir().join(format!("mf-bundled-rustd-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    // A sibling `node` must not satisfy the mainframe-daemon scan.
    let mut n = std::fs::File::create(dir.join("node")).unwrap();
    n.write_all(&vec![0u8; (MIN_SIDECAR_BIN_BYTES + 1) as usize])
        .unwrap();
    assert!(find_bundled_binary_in(&dir, "mainframe-daemon").is_none());

    // Zero-byte placeholder ignored.
    std::fs::File::create(dir.join("mainframe-daemon-aarch64-apple-darwin")).unwrap();
    assert!(find_bundled_binary_in(&dir, "mainframe-daemon").is_none());

    // Real-sized triple binary found via the fallback.
    let mut f =
        std::fs::File::create(dir.join("mainframe-daemon-x86_64-unknown-linux-gnu")).unwrap();
    f.write_all(&vec![0u8; (MIN_SIDECAR_BIN_BYTES + 1) as usize])
        .unwrap();
    assert_eq!(
        find_bundled_binary_in(&dir, "mainframe-daemon"),
        Some(dir.join("mainframe-daemon-x86_64-unknown-linux-gnu"))
    );

    // Exact base name wins over the triple sibling.
    let mut f = std::fs::File::create(dir.join("mainframe-daemon")).unwrap();
    f.write_all(&vec![0u8; (MIN_SIDECAR_BIN_BYTES + 1) as usize])
        .unwrap();
    assert_eq!(
        find_bundled_binary_in(&dir, "mainframe-daemon"),
        Some(dir.join("mainframe-daemon"))
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn daemon_env_overrides_remove_shell_owned_data_dir_when_not_explicit() {
    assert!(daemon_env_overrides(31500, None).contains(&EnvOverride::Remove("MAINFRAME_DATA_DIR")));
}

#[test]
fn daemon_env_overrides_keep_explicit_data_dir() {
    assert!(
        daemon_env_overrides(31500, Some(Path::new("/tmp/mainframe-data"))).contains(
            &EnvOverride::Set("MAINFRAME_DATA_DIR", "/tmp/mainframe-data".to_string())
        )
    );
}

#[cfg(unix)]
#[test]
fn emergency_kill_reaches_the_child_during_grace() {
    use std::io::{BufRead, BufReader};
    use std::os::unix::process::ExitStatusExt;

    let mut child = Command::new("/bin/sh")
        .args(["-c", "trap '' TERM; echo ready; exec sleep 100"])
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    output.read_line(&mut line).unwrap();
    assert_eq!(line, "ready\n");
    let handle = DaemonHandle::new(Some(child));
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| {
            stop_child(
                &handle.child,
                Duration::from_secs(2),
                Duration::from_millis(10),
            )
        });
        let deadline = Instant::now() + Duration::from_secs(1);
        while !handle.child.lock().unwrap().stopping {
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        assert!(handle.pid().is_some());
        handle.kill_now();
        let status = worker.join().unwrap().unwrap().unwrap();
        assert_eq!(status.signal(), Some(libc::SIGKILL));
    });
    assert_eq!(handle.pid(), None);
}

#[cfg(unix)]
#[test]
fn sidecar_parent_is_passed_only_as_a_launch_argument() {
    let mut command = Command::new("unused");
    command.env("MAINFRAME_SIDECAR_PARENT_PID", "42");
    configure_parent_watch(&mut command);

    let args = command
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert_eq!(
        args,
        [format!("--sidecar-parent-pid={}", std::process::id())]
    );
    assert_eq!(
        command
            .get_envs()
            .find(|(key, _)| *key == "MAINFRAME_SIDECAR_PARENT_PID"),
        Some((std::ffi::OsStr::new("MAINFRAME_SIDECAR_PARENT_PID"), None)),
    );
}
