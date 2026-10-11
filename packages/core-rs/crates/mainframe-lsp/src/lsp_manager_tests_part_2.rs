#[tokio::test]
async fn idle_timer_fires_and_shuts_down_server_after_timeout() {
    let (m, _) = manager();
    m.get_or_spawn("proj1", "typescript", "/tmp").await.unwrap();
    assert!(
        m.get_active_languages("proj1")
            .contains(&"typescript".to_string())
    );

    // Idle timeout is 60ms; the graceful shutdown handshake adds request+exit
    // timeouts (150ms each) before the SIGTERM fallback.
    mainframe_runtime::test_support::poll_until(
        Duration::from_secs(1),
        Duration::from_millis(25),
        async || {
            !m.get_active_languages("proj1")
                .contains(&"typescript".to_string())
        },
    )
    .await
    .expect("idle timer did not shut down the server");
}

async fn assert_pid_gone(pid: u32) {
    mainframe_runtime::test_support::poll_until(
        Duration::from_secs(2),
        Duration::from_millis(10),
        async || !(mainframe_runtime::process::is_alive(pid)),
    )
    .await
    .expect("the stopped child must no longer exist");
}
