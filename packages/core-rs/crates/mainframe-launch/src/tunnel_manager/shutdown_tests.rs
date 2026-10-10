use super::*;
#[tokio::test]
async fn records_the_spawned_pid_and_forgets_it_on_stop() {
    let dir = tempfile::tempdir().unwrap();
    let bin = write_fake_cloudflared(dir.path());
    let registry = RecordingRegistry::new();
    let config = TunnelConfig {
        cloudflared_bin: bin.clone(),
        dns_poll: Duration::from_millis(20),
        dns_timeout: Duration::from_millis(100),
        ..TunnelConfig::default()
    };
    let manager = manager_with(config, registry.clone());

    manager.start(4173, "preview:Dev", None).await.unwrap();
    sleep(Duration::from_millis(50)).await; // let the fire-and-forget add() run

    let added = registry.added();
    assert_eq!(added.len(), 1);
    assert_eq!(added[0].kind, ManagedChildKind::Tunnel);
    assert_eq!(added[0].command, bin);
    assert_eq!(added[0].label, "preview:Dev");
    assert!(!added[0].group);
    let pid = added[0].pid;

    manager.stop("preview:Dev").await;
    // stop() returns only after the watcher reaped the child and forgot it.
    assert!(registry.removed().contains(&pid));
}
#[tokio::test]
async fn stop_all_reaps_a_child_still_mid_start_and_forgets_its_pid() {
    let dir = tempfile::tempdir().unwrap();
    let registry = RecordingRegistry::new();
    let (manager, signals) = signal_manager(
        write_silent_cloudflared(dir.path()),
        Duration::from_secs(5),
        registry.clone(),
    );
    let (task, pid) = start_until_spawned(&manager, &registry, "preview:Dev").await;

    manager.stop_all().await;

    assert_eq!(*signals.lock().unwrap(), vec![(pid, "-TERM")]);
    assert!(registry.removed().contains(&i64::from(pid)));
    assert_eq!(manager.live_count(), 0);
    assert_pid_gone(pid).await;
    assert!(task.await.unwrap().is_err());
}
#[tokio::test]
async fn stop_all_escalates_to_sigkill_when_a_starting_child_ignores_sigterm() {
    let dir = tempfile::tempdir().unwrap();
    let registry = RecordingRegistry::new();
    let (manager, signals) = signal_manager(
        write_term_ignoring_cloudflared(dir.path()),
        Duration::from_millis(500),
        registry.clone(),
    );
    let (task, pid) = start_until_spawned(&manager, &registry, "preview:Dev").await;
    wait_until_trapped(dir.path()).await;

    manager.stop_all().await;

    assert_eq!(
        *signals.lock().unwrap(),
        vec![(pid, "-TERM"), (pid, "-KILL")]
    );
    assert!(registry.removed().contains(&i64::from(pid)));
    assert_eq!(manager.live_count(), 0);
    assert_pid_gone(pid).await;
    assert!(task.await.unwrap().is_err());
}
#[tokio::test]
async fn stop_all_signals_every_tunnel_before_escalating_any() {
    let dir = tempfile::tempdir().unwrap();
    let registry = RecordingRegistry::new();
    let (manager, signals) = signal_manager(
        write_ready_term_ignoring_cloudflared(dir.path()),
        Duration::from_millis(1_000),
        registry.clone(),
    );
    manager.start(4173, "preview:Web", None).await.unwrap();
    manager.start(4174, "preview:Api", None).await.unwrap();
    let mut pids = [
        manager.pid_of("preview:Web").unwrap(),
        manager.pid_of("preview:Api").unwrap(),
    ];
    pids.sort_unstable();

    manager.stop_all().await;

    // Stopped one after another, the first tunnel's SIGKILL would come
    // before the second tunnel's SIGTERM.
    let mut flags = signals.lock().unwrap().clone();
    let (terms, kills) = flags.split_at_mut(2);
    terms.sort_unstable();
    kills.sort_unstable();
    assert_eq!(terms, [(pids[0], "-TERM"), (pids[1], "-TERM")]);
    assert_eq!(kills, [(pids[0], "-KILL"), (pids[1], "-KILL")]);
    assert_eq!(manager.live_count(), 0);
    for pid in pids {
        assert_pid_gone(pid).await;
    }
}
#[tokio::test]
async fn stop_sends_only_sigterm_to_a_tunnel_that_exits_on_it() {
    let dir = tempfile::tempdir().unwrap();
    let registry = RecordingRegistry::new();
    let (manager, signals) = signal_manager(
        write_fake_cloudflared(dir.path()),
        Duration::from_secs(5),
        registry.clone(),
    );
    manager.start(4173, "preview:Dev", None).await.unwrap();
    let pid = manager.pid_of("preview:Dev").unwrap();

    manager.stop("preview:Dev").await;

    assert_eq!(*signals.lock().unwrap(), vec![(pid, "-TERM")]);
    assert_eq!(manager.live_count(), 0);
    assert_pid_gone(pid).await;
    assert_eq!(manager.get_url("preview:Dev"), None);
}
#[tokio::test]
async fn stop_escalates_to_sigkill_and_waits_for_a_tunnel_that_ignores_sigterm() {
    let dir = tempfile::tempdir().unwrap();
    let registry = RecordingRegistry::new();
    let (manager, signals) = signal_manager(
        write_ready_term_ignoring_cloudflared(dir.path()),
        Duration::from_millis(500),
        registry.clone(),
    );
    manager.start(4173, "preview:Dev", None).await.unwrap();
    let pid = manager.pid_of("preview:Dev").unwrap();

    manager.stop("preview:Dev").await;

    assert_eq!(
        *signals.lock().unwrap(),
        vec![(pid, "-TERM"), (pid, "-KILL")]
    );
    assert!(registry.removed().contains(&i64::from(pid)));
    assert_eq!(manager.live_count(), 0);
    assert_pid_gone(pid).await;
}
#[tokio::test]
async fn individual_stop_retains_registry_until_exit_and_concurrent_stop_waits() {
    let dir = tempfile::tempdir().unwrap();
    let registry = RecordingRegistry::new();
    let (manager, signals) = signal_manager(
        write_ready_term_ignoring_cloudflared(dir.path()),
        Duration::from_millis(500),
        registry.clone(),
    );
    manager.start(4173, "preview:Dev", None).await.unwrap();
    let pid = manager.pid_of("preview:Dev").unwrap();
    let stopping = manager.clone();
    let first = tokio::spawn(async move { stopping.stop("preview:Dev").await });
    tokio::time::timeout(Duration::from_secs(2), async {
        while signals.lock().unwrap().is_empty() {
            sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    assert!(!registry.removed().contains(&i64::from(pid)));
    assert_eq!(manager.live_count(), 1);
    manager.stop("preview:Dev").await;
    first.await.unwrap();
    assert_eq!(manager.live_count(), 0);
    assert_pid_gone(pid).await;
    assert!(registry.removed().contains(&i64::from(pid)));
}
#[tokio::test]
async fn failed_signals_keep_the_registry_entry_and_allow_a_retry() {
    let dir = tempfile::tempdir().unwrap();
    let registry = RecordingRegistry::new();
    let enabled = Arc::new(AtomicBool::new(false));
    let switch = enabled.clone();
    let deliver = kill_signal();
    let mut manager = manager_with(
        TunnelConfig {
            cloudflared_bin: write_ready_term_ignoring_cloudflared(dir.path()),
            dns_poll: Duration::from_millis(10),
            dns_timeout: Duration::from_millis(20),
            stop_grace: Duration::from_secs(1),
            ..TunnelConfig::default()
        },
        registry.clone(),
    );
    manager.set_signal(Arc::new(move |pid, flag| {
        if switch.load(Ordering::SeqCst) {
            deliver(pid, flag)
        } else {
            Box::pin(async { false })
        }
    }));
    manager.start(4173, "preview:Dev", None).await.unwrap();
    let pid = manager.pid_of("preview:Dev").unwrap();
    manager.stop("preview:Dev").await;
    assert_eq!(manager.live_count(), 1);
    assert!(!registry.removed().contains(&i64::from(pid)));
    enabled.store(true, Ordering::SeqCst);
    manager.stop("preview:Dev").await;
    assert_eq!(manager.live_count(), 0);
    assert_pid_gone(pid).await;
    assert!(registry.removed().contains(&i64::from(pid)));
}
#[tokio::test]
async fn cancelling_a_start_kills_its_child() {
    let dir = tempfile::tempdir().unwrap();
    let registry = RecordingRegistry::new();
    let (manager, signals) = signal_manager(
        write_silent_cloudflared(dir.path()),
        Duration::from_secs(5),
        registry.clone(),
    );
    let (task, pid) = start_until_spawned(&manager, &registry, "preview:Dev").await;

    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    tokio::time::timeout(Duration::from_secs(2), async {
        while manager.live_count() > 0 {
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the cancelled start's child should be reaped");

    assert_eq!(*signals.lock().unwrap(), vec![(pid, "-KILL")]);
}
#[tokio::test]
async fn restarting_a_label_keeps_the_new_tunnel_when_the_old_child_exits() {
    let dir = tempfile::tempdir().unwrap();
    let (broadcast, events) = recorder();
    let config = TunnelConfig {
        cloudflared_bin: write_counting_cloudflared(dir.path()),
        dns_poll: Duration::from_millis(20),
        dns_timeout: Duration::from_millis(60),
        ..TunnelConfig::default()
    };
    let manager = TunnelManager::with_config(Some(broadcast), config);

    manager.start(3000, "daemon", None).await.unwrap();
    manager.start(3000, "daemon", None).await.unwrap();
    // Give the first child's exit watcher time to run.
    sleep(Duration::from_millis(100)).await;

    assert_eq!(
        manager.get_url("daemon").as_deref(),
        Some("https://abc-def2.trycloudflare.com")
    );
    assert_eq!(stopped_broadcasts(&events), 1);
    manager.stop("daemon").await;
}

#[tokio::test]
async fn individual_stop_reaps_a_child_that_has_not_published_its_url() {
    let dir = tempfile::tempdir().unwrap();
    let registry = RecordingRegistry::new();
    let (manager, signals) = signal_manager(
        write_term_ignoring_cloudflared(dir.path()),
        Duration::from_millis(100),
        registry.clone(),
    );
    let (start, pid) = start_until_spawned(&manager, &registry, "preview:Dev").await;
    wait_until_trapped(dir.path()).await;
    manager.stop("preview:Dev").await;
    assert!(start.await.unwrap().is_err());
    assert_eq!(
        *signals.lock().unwrap(),
        vec![(pid, "-TERM"), (pid, "-KILL")]
    );
    assert!(registry.removed().contains(&i64::from(pid)));
    assert_pid_gone(pid).await;
}
