use super::*;

#[tokio::test]
async fn emits_effective_path_in_status_events() {
    let (broadcast, events) = recorder();
    let manager = manager(broadcast);
    manager
        .start(&cfg("ep-test", "exit 0", None))
        .await
        .unwrap();
    sleep(Duration::from_millis(200)).await;
    let paths: Vec<String> = events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            DaemonEvent::LaunchStatus { effective_path, .. } => Some(effective_path.clone()),
            _ => None,
        })
        .collect();
    assert!(!paths.is_empty());
    assert!(paths.iter().all(|p| p == "/tmp"));
    manager.stop_all().await;
}

#[tokio::test]
async fn emits_effective_path_in_output_events() {
    let (broadcast, events) = recorder();
    let manager = manager(broadcast);
    manager
        .start(&cfg("ep-out", "printf hi", None))
        .await
        .unwrap();
    sleep(Duration::from_millis(200)).await;
    let paths: Vec<String> = events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            DaemonEvent::LaunchOutput { effective_path, .. } => Some(effective_path.clone()),
            _ => None,
        })
        .collect();
    assert!(!paths.is_empty());
    assert!(paths.iter().all(|p| p == "/tmp"));
    manager.stop_all().await;
}

#[tokio::test]
async fn passes_env_vars_to_the_spawned_process() {
    let (broadcast, events) = recorder();
    let manager = manager(broadcast);
    let mut config = cfg("env-test", "printf \"$MY_VAR\"", None);
    config.env = Some(
        [("MY_VAR".to_string(), "hello-from-env".to_string())]
            .into_iter()
            .collect(),
    );
    manager.start(&config).await.unwrap();
    sleep(Duration::from_millis(200)).await;
    assert!(
        output_events(&events)
            .iter()
            .any(|(_, d)| d.contains("hello-from-env"))
    );
    manager.stop_all().await;
}

#[tokio::test]
async fn retains_stdout_from_a_near_instant_exit_via_output_buffer() {
    let (broadcast, _events) = recorder();
    let manager = manager(broadcast);
    manager
        .start(&cfg("echo-once", "printf 'hello-from-launch\\n'", None))
        .await
        .unwrap();
    sleep(Duration::from_millis(200)).await;
    let buffer = manager.get_output_buffer("echo-once");
    assert!(buffer.iter().any(|e| e.data.contains("hello-from-launch")));
}

#[tokio::test]
async fn resets_the_buffer_on_the_next_start() {
    let (broadcast, _events) = recorder();
    let manager = manager(broadcast);
    manager
        .start(&cfg("echo-once", "printf 'first-run\\n'", None))
        .await
        .unwrap();
    sleep(Duration::from_millis(200)).await;
    assert!(
        manager
            .get_output_buffer("echo-once")
            .iter()
            .any(|e| e.data.contains("first-run"))
    );

    manager
        .start(&cfg("echo-once", "printf 'second-run\\n'", None))
        .await
        .unwrap();
    sleep(Duration::from_millis(200)).await;
    let buffer = manager.get_output_buffer("echo-once");
    assert!(buffer.iter().any(|e| e.data.contains("second-run")));
    assert!(!buffer.iter().any(|e| e.data.contains("first-run")));
}

#[tokio::test]
async fn waits_for_a_listening_port_before_running() {
    // The test owns a listener on an ephemeral port; the launched process is a
    // bare sleep, so `running` is gated purely on the TCP-connect probe.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port() as i64;
    tokio::spawn(async move {
        loop {
            if listener.accept().await.is_err() {
                return;
            }
        }
    });

    let (broadcast, _events) = recorder();
    let manager = manager(broadcast);
    manager
        .start(&cfg("web", "sleep 100", Some(port)))
        .await
        .unwrap();
    assert_eq!(manager.get_status("web"), LaunchProcessStatus::Running);
    manager.stop("web").await;
}

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
