use super::*;

#[tokio::test]
async fn shutdown_rejects_a_replacement_already_waiting_for_the_previous_child() {
    let dir = tempfile::tempdir().unwrap();
    let registry = RecordingRegistry::new();
    let (manager, signals) = signal_manager(
        write_ready_term_ignoring_cloudflared(dir.path()),
        Duration::from_millis(500),
        registry.clone(),
    );
    manager.start(4173, "daemon", None).await.unwrap();
    let pid = manager.pid_of("daemon").unwrap();
    let starting = manager.clone();
    let replacement = tokio::spawn(async move { starting.start(4173, "daemon", None).await });
    mainframe_runtime::test_support::poll_until(
        Duration::from_secs(2),
        Duration::from_millis(5),
        async || !signals.lock().unwrap().is_empty(),
    )
    .await
    .unwrap();
    manager.close_starts().await;
    manager.stop_all().await;
    assert_eq!(
        replacement.await.unwrap().unwrap_err().to_string(),
        "Daemon is shutting down"
    );
    assert_eq!(registry.added().len(), 1);
    assert_eq!(manager.live_count(), 0);
    assert_pid_gone(pid).await;
}
