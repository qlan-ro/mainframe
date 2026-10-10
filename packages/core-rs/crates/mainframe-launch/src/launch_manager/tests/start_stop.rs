use super::*;

#[tokio::test]
async fn starts_a_process_and_emits_status_running() {
    let (broadcast, events) = recorder();
    let manager = manager(broadcast);
    manager
        .start(&cfg("server", "printf hello; exit 0", None))
        .await
        .unwrap();
    let statuses = status_events(&events);
    assert!(statuses.iter().any(|(_, s)| matches!(
        s,
        LaunchProcessStatus::Starting | LaunchProcessStatus::Running
    )));
    manager.stop_all().await;
}

#[tokio::test]
async fn emits_output_events_from_stdout() {
    let (broadcast, events) = recorder();
    let manager = manager(broadcast);
    manager
        .start(&cfg("server", "printf hello", None))
        .await
        .unwrap();
    sleep(Duration::from_millis(200)).await;
    assert!(
        output_events(&events)
            .iter()
            .any(|(_, d)| d.contains("hello"))
    );
    manager.stop_all().await;
}

#[tokio::test]
async fn stop_emits_status_stopped() {
    let (broadcast, events) = recorder();
    let manager = manager(broadcast);
    manager
        .start(&cfg("server", "sleep 100", None))
        .await
        .unwrap();
    manager.stop("server").await;
    assert!(
        status_events(&events)
            .iter()
            .any(|(_, s)| *s == LaunchProcessStatus::Stopped)
    );
}

#[tokio::test]
async fn restart_during_stop_teardown_respawns_after_exit() {
    let (broadcast, events) = recorder();
    let manager = Arc::new(LaunchManager::with_timings(
        "proj-1",
        "/tmp",
        broadcast,
        None,
        None,
        None,
        default_read_command(),
        LaunchTimings {
            stop_grace: Duration::from_millis(300),
            ..LaunchTimings::default()
        },
    ));

    // Loops so a group SIGTERM (which kills the `sleep` child, default
    // disposition) doesn't end the `sh` script itself — it must survive to
    // SIGKILL. The 50ms settle below lets the trap actually install before
    // stop() fires; without it, SIGTERM can race the shell's startup and
    // kill it via default disposition before the trap takes effect.
    let config = cfg("server", "trap '' TERM; while :; do sleep 0.2; done", None);
    manager.start(&config).await.unwrap();
    assert_eq!(manager.get_status("server"), LaunchProcessStatus::Running);
    sleep(Duration::from_millis(50)).await;

    let stop_manager = manager.clone();
    let stop_task = tokio::spawn(async move { stop_manager.stop("server").await });

    sleep(Duration::from_millis(100)).await;
    manager.start(&config).await.unwrap();

    stop_task.await.unwrap();

    assert_eq!(manager.get_status("server"), LaunchProcessStatus::Running);

    let statuses = status_events(&events);
    let stopped_idx = statuses
        .iter()
        .position(|(name, status)| name == "server" && *status == LaunchProcessStatus::Stopped)
        .expect("expected a Stopped status event");
    assert!(
        statuses[stopped_idx + 1..]
            .iter()
            .any(|(name, status)| name == "server" && *status == LaunchProcessStatus::Starting),
        "expected a Starting event after the Stopped event"
    );

    manager.stop("server").await;
}

#[tokio::test]
async fn get_status_returns_stopped_for_unknown_name() {
    let (broadcast, _events) = recorder();
    let manager = manager(broadcast);
    assert_eq!(
        manager.get_status("nonexistent"),
        LaunchProcessStatus::Stopped
    );
}

#[tokio::test]
async fn retains_failed_status_after_exit() {
    let (broadcast, _events) = recorder();
    let manager = manager(broadcast);
    manager
        .start(&cfg("fail-fast", "exit 1", None))
        .await
        .unwrap();
    sleep(Duration::from_millis(300)).await;
    assert_eq!(manager.get_status("fail-fast"), LaunchProcessStatus::Failed);
    assert_eq!(
        manager.get_all_statuses().get("fail-fast").copied(),
        Some(LaunchProcessStatus::Failed)
    );
}

#[tokio::test]
async fn signal_group_terminates_a_group_leader_child() {
    let mut command = Command::new("sh");
    command
        .args(["-c", "sleep 30"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    command.process_group(0);
    let mut child = command.spawn().unwrap();

    signal_group(child.id(), Signal::Term);

    let exited = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
    assert!(exited.is_ok(), "child survived the group SIGTERM");
}

#[tokio::test]
async fn get_status_returns_running_while_alive() {
    let (broadcast, _events) = recorder();
    let manager = manager(broadcast);
    manager
        .start(&cfg("server", "sleep 100", None))
        .await
        .unwrap();
    assert_eq!(manager.get_status("server"), LaunchProcessStatus::Running);
    manager.stop("server").await;
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
