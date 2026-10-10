use super::*;

#[tokio::test]
async fn records_the_live_post_shebang_command_line_not_the_executable() {
    // The kernel rewrites argv for a #! script (spawning `pnpm` shows
    // `node …/pnpm run dev` in `ps`), which is what the sweep compares
    // against — so we record the LIVE command line, not the bare executable.
    let dir = tempfile::tempdir().unwrap();
    let real = std::fs::canonicalize(dir.path()).unwrap();
    let registry = RecordingRegistry::new();
    let live = "node /opt/homebrew/bin/pnpm run dev";
    let manager = LaunchManager::with_read_command(
        "proj-1",
        dir.path().to_string_lossy().into_owned(),
        recorder().0,
        None,
        None,
        Some(registry.clone()),
        reader(Some(live)),
    );

    manager
        .start(&launch_cfg("dev", "sh", &["-c", "sleep 5"]))
        .await
        .unwrap();
    let entry = poll_added(&registry).await;

    assert_eq!(entry.kind, ManagedChildKind::Launch);
    assert_eq!(entry.command, live);
    assert_eq!(entry.args, Vec::<String>::new());
    assert!(entry.group);
    assert_eq!(entry.label, "proj-1:dev");
    assert_eq!(entry.cwd.as_deref(), Some(real.to_string_lossy().as_ref()));
    manager.stop_all().await;
}

#[tokio::test]
async fn records_the_realpath_resolved_cwd() {
    // The sweep compares the recorded cwd against `lsof`, which reports the
    // realpath; a symlinked spawn cwd must be resolved at record time.
    let dir = tempfile::tempdir().unwrap();
    let real = std::fs::canonicalize(dir.path()).unwrap();
    let registry = RecordingRegistry::new();
    let manager = LaunchManager::with_read_command(
        "proj-1",
        dir.path().to_string_lossy().into_owned(),
        recorder().0,
        None,
        None,
        Some(registry.clone()),
        reader(Some("node /pnpm run dev")),
    );

    manager
        .start(&launch_cfg("dev", "sh", &["-c", "sleep 5"]))
        .await
        .unwrap();
    let entry = poll_added(&registry).await;
    assert_eq!(entry.cwd.as_deref(), Some(real.to_string_lossy().as_ref()));
    manager.stop_all().await;
}

#[tokio::test]
async fn falls_back_to_the_resolved_executable_and_argv_when_live_is_unavailable() {
    // If `ps` can't read the pid, keep a best-effort record from what we
    // spawned — the resolved absolute path for a relative executable.
    let dir = tempfile::tempdir().unwrap();
    write_executable(&dir.path().join("gradlew"), "#!/bin/sh\nsleep 5\n");
    let registry = RecordingRegistry::new();
    let manager = LaunchManager::with_read_command(
        "proj-1",
        dir.path().to_string_lossy().into_owned(),
        recorder().0,
        None,
        None,
        Some(registry.clone()),
        reader(None),
    );

    manager
        .start(&launch_cfg("dev", "./gradlew", &["bootRun"]))
        .await
        .unwrap();
    let entry = poll_added(&registry).await;
    let expected = lexical_resolve(&dir.path().to_string_lossy(), "./gradlew");
    assert_eq!(entry.command, expected);
    assert_eq!(entry.args, vec!["bootRun".to_string()]);
    manager.stop_all().await;
}

#[tokio::test]
async fn forgets_the_pid_when_the_launch_process_exits() {
    // In Rust a spawn either yields a pid (recorded, forgotten on exit) or
    // fails without one.
    let dir = tempfile::tempdir().unwrap();
    let registry = RecordingRegistry::new();
    let manager = LaunchManager::with_read_command(
        "proj-1",
        dir.path().to_string_lossy().into_owned(),
        recorder().0,
        None,
        None,
        Some(registry.clone()),
        reader(Some("node /pnpm run dev")),
    );

    manager
        .start(&launch_cfg("dev", "sh", &["-c", "sleep 0.1"]))
        .await
        .unwrap();
    let pid = poll_added(&registry).await.pid;
    for _ in 0..80 {
        if registry.removed().contains(&pid) {
            break;
        }
        sleep(Duration::from_millis(25)).await;
    }
    assert!(registry.removed().contains(&pid));
}

#[tokio::test]
async fn kills_the_process_group_and_forgets_the_pid_on_stop() {
    let dir = tempfile::tempdir().unwrap();
    let registry = RecordingRegistry::new();
    let manager = LaunchManager::with_read_command(
        "proj-1",
        dir.path().to_string_lossy().into_owned(),
        recorder().0,
        None,
        None,
        Some(registry.clone()),
        reader(Some("node /pnpm run dev")),
    );

    manager
        .start(&launch_cfg("dev", "sh", &["-c", "sleep 100"]))
        .await
        .unwrap();
    let pid = poll_added(&registry).await.pid;
    manager.stop("dev").await;
    assert_eq!(manager.get_status("dev"), LaunchProcessStatus::Stopped);
    for _ in 0..80 {
        if registry.removed().contains(&pid) {
            break;
        }
        sleep(Duration::from_millis(25)).await;
    }
    assert!(registry.removed().contains(&pid));
}

// End-to-end proof (no mocks) that the real sweep reaps a launch orphan. The
// child is a #! shell script, so the kernel rewrites its argv — the exact case
// a bare-executable identity guard silently fails to match.
//
// Ignored on Linux: `process_matches_launch` compares the recorded command line
// against `ps -o command=`, and Linux reports a shebang child's argv differently
// than macOS, so this real-spawn integration test doesn't reap there. The daemon
// is macOS-verified only (Linux is a platform-matrix TODO); the
// 325-case unit matching tests still run on Linux. Revisit the matcher against
// real Linux `ps` output when Linux packaging is taken up.
#[cfg_attr(
    target_os = "linux",
    ignore = "sweep argv-match is macOS-shaped; Linux is a packaging TODO"
)]
#[tokio::test]
async fn records_a_shebang_child_so_the_real_sweep_reaps_its_group() {
    let dir = tempfile::tempdir().unwrap();
    write_executable(&dir.path().join("sleeper.sh"), "#!/bin/sh\nsleep 30\n");
    let registry = Arc::new(FileChildRegistry::new(
        dir.path()
            .join("children.json")
            .to_string_lossy()
            .into_owned(),
    ));
    let manager = LaunchManager::new(
        "proj-1",
        dir.path().to_string_lossy().into_owned(),
        recorder().0,
        None,
        None,
        Some(registry.clone()),
    );

    manager
        .start(&launch_cfg("dev", "./sleeper.sh", &[]))
        .await
        .unwrap();

    let recorded = registry.list().await;
    assert_eq!(recorded.len(), 1);
    let pid = recorded[0].pid;
    assert!(
        crate::process::sweep::default_process_command(pid)
            .await
            .is_some()
    );

    let mut deps = default_sweep_deps();
    deps.grace = Some(Duration::from_millis(500));
    let result = sweep_stray_children(&*registry, &deps).await;
    assert_eq!(result.reaped, 1);

    // SIGTERM delivery is async; the process exits shortly after.
    let mut gone = false;
    for _ in 0..40 {
        if crate::process::sweep::default_process_command(pid)
            .await
            .is_none()
        {
            gone = true;
            break;
        }
        sleep(Duration::from_millis(50)).await;
    }
    assert!(gone);
    assert!(registry.list().await.is_empty());

    // Cleanup: reap the group if anything survived the assertions.
    crate::process::sweep::default_kill(pid, Signal::Kill, true);
}
