use super::*;
use mainframe_launch::{
    LaunchRegistry, TunnelConfig, TunnelManager, shutdown_launches_and_tunnels,
};
use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;
use tokio::time::{sleep, timeout};

#[path = "fixture.rs"]
mod fixture;

async fn held_start_exits_before_shell_deadline(registered: bool) {
    let dir = tempfile::tempdir().unwrap();
    let (tunnels, pid_file) = fixture::tunnels(&dir, registered);
    let launches = Arc::new(LaunchRegistry::new(Arc::new(|_| {}), Some(tunnels.clone())));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/tunnel/start", listener.local_addr().unwrap());
    let (signal, signaled) = tokio::sync::oneshot::channel();
    let app = fixture::app(&dir, tunnels.clone());
    let cleanup_tunnels = tunnels.clone();
    let server = tokio::spawn(serve(
        listener,
        app,
        async { signaled.await.unwrap() },
        async move {
            shutdown_launches_and_tunnels(&launches, &cleanup_tunnels).await;
        },
    ));
    let request = fixture::request(url);
    let pid = fixture::wait_for_pid(&pid_file).await;
    fixture::wait_for_phase(&tunnels, registered).await;
    assert!(
        !request.is_finished(),
        "start must still be waiting when shutdown begins"
    );
    signal.send(()).unwrap();
    timeout(Duration::from_secs(8), server)
        .await
        .expect("cleanup must beat the shell's 10-second deadline")
        .unwrap()
        .unwrap();
    fixture::assert_pid_gone(pid);
    assert_eq!(
        tunnels.start(31415, "late", None).await.unwrap_err(),
        "Daemon is shutting down"
    );
    request.abort();
}

#[tokio::test]
async fn shutdown_reaps_tunnel_while_http_start_waits_for_registration() {
    held_start_exits_before_shell_deadline(false).await;
}

#[tokio::test]
async fn shutdown_reaps_tunnel_while_http_start_waits_for_dns() {
    held_start_exits_before_shell_deadline(true).await;
}

#[tokio::test]
async fn server_error_still_runs_cleanup() {
    let dir = tempfile::tempdir().unwrap();
    let (tunnels, pid_file) = fixture::tunnels(&dir, false);
    let launches = LaunchRegistry::new(Arc::new(|_| {}), Some(tunnels.clone()));
    let starting = tunnels.clone();
    let start = tokio::spawn(async move { starting.start(31415, "daemon", None).await });
    let pid = fixture::wait_for_pid(&pid_file).await;
    let (stop, _stopped) = tokio::sync::oneshot::channel();
    let result = timeout(
        Duration::from_secs(8),
        finish(
            async { Err(std::io::Error::other("listener failed")) },
            std::future::pending(),
            stop,
            shutdown_launches_and_tunnels(&launches, &tunnels),
        ),
    )
    .await
    .unwrap();
    assert_eq!(result.unwrap_err().to_string(), "listener failed");
    fixture::assert_pid_gone(pid);
    assert!(start.await.unwrap().is_err());
}
