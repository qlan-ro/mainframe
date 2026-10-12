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
    let mut child = spawn_sh("exec sleep 100");

    let status = stop_child(
        &mut child,
        Duration::from_secs(10),
        Duration::from_millis(10),
    )
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
    let mut child = spawn_sh(&format!(
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
        &mut child,
        Duration::from_millis(200),
        Duration::from_millis(10),
    )
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
