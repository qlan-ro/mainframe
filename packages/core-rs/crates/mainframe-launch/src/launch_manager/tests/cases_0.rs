use super::*;

#[test]
fn clean_env_uses_orig_path_and_does_not_forward_it() {
    let source: HashMap<String, String> = [
        ("PATH", "/mainframe/bundled/bin:/usr/bin"),
        ("MAINFRAME_ORIG_PATH", "/usr/bin:/usr/local/bin"),
        ("HOME", "/home/u"),
        ("ELECTRON_RUN_AS_NODE", "1"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    let env = clean_env(&source);
    assert_eq!(
        env.get("PATH").map(String::as_str),
        Some("/usr/bin:/usr/local/bin")
    );
    assert_eq!(env.get("MAINFRAME_ORIG_PATH"), None);
    assert_eq!(env.get("HOME").map(String::as_str), Some("/home/u"));
    // Non-allowlisted daemon vars are dropped.
    assert_eq!(env.get("ELECTRON_RUN_AS_NODE"), None);
}

#[test]
fn clean_env_falls_back_to_daemon_path_when_orig_unset() {
    let source: HashMap<String, String> = [("PATH", "/usr/bin:/usr/local/bin")]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    let env = clean_env(&source);
    assert_eq!(
        env.get("PATH").map(String::as_str),
        Some("/usr/bin:/usr/local/bin")
    );
}

#[test]
fn clean_env_forwards_lc_and_lang_prefixes() {
    let source: HashMap<String, String> =
        [("LC_ALL", "C"), ("LANG", "en_US.UTF-8"), ("NPM_TOKEN", "x")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
    let env = clean_env(&source);
    assert_eq!(env.get("LC_ALL").map(String::as_str), Some("C"));
    assert_eq!(env.get("LANG").map(String::as_str), Some("en_US.UTF-8"));
    assert_eq!(env.get("NPM_TOKEN"), None);
}

#[test]
fn compose_injects_resolved_path_when_orig_absent() {
    let source = env_source(&[("PATH", "/mainframe/bundled/bin:/usr/bin")]);
    let env = compose_launch_env(source, Some("/opt/homebrew/bin:/usr/bin"));
    assert_eq!(
        env.get("PATH").map(String::as_str),
        Some("/opt/homebrew/bin:/usr/bin")
    );
}

#[test]
fn compose_orig_path_overrides_injected_resolved_path() {
    let source = env_source(&[
        ("PATH", "/mainframe/bundled/bin:/usr/bin"),
        ("MAINFRAME_ORIG_PATH", "/usr/bin:/usr/local/bin"),
    ]);
    let env = compose_launch_env(source, Some("/opt/homebrew/bin:/usr/bin"));
    // The standalone contract wins even when a resolved PATH is injected.
    assert_eq!(
        env.get("PATH").map(String::as_str),
        Some("/usr/bin:/usr/local/bin")
    );
    assert_eq!(env.get("MAINFRAME_ORIG_PATH"), None);
}

#[test]
fn compose_inherits_daemon_path_when_no_resolved_path() {
    let source = env_source(&[("PATH", "/usr/bin:/usr/local/bin")]);
    let env = compose_launch_env(source, None);
    assert_eq!(
        env.get("PATH").map(String::as_str),
        Some("/usr/bin:/usr/local/bin")
    );
}

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
