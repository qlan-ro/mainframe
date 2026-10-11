use super::*;
use crate::test_support::{recorder, recording_signal, write_ready_term_ignoring_cloudflared};
use crate::tunnel_manager::TunnelConfig;
use mainframe_types::events::DaemonEvent;
use mainframe_types::launch::LaunchConfiguration;
use std::sync::Mutex;
use std::time::Duration;

fn noop() -> BroadcastFn {
    Arc::new(|_ev: DaemonEvent| {})
}

#[tokio::test]
async fn get_or_create_returns_the_same_manager_per_key() {
    let registry = LaunchRegistry::new(noop(), None);
    let a = registry.get_or_create("p1", "/wt/x");
    let b = registry.get_or_create("p1", "/wt/x");
    assert!(Arc::ptr_eq(&a, &b));
}

#[tokio::test]
async fn distinct_keys_get_distinct_managers() {
    let registry = LaunchRegistry::new(noop(), None);
    let a = registry.get_or_create("p1", "/wt/x");
    let b = registry.get_or_create("p1", "/wt/y");
    assert!(!Arc::ptr_eq(&a, &b));
}

#[tokio::test]
async fn get_returns_none_until_created() {
    let registry = LaunchRegistry::new(noop(), None);
    assert!(registry.get("p1", "/wt/x").is_none());
    registry.get_or_create("p1", "/wt/x");
    assert!(registry.get("p1", "/wt/x").is_some());
}

#[tokio::test]
async fn stop_all_clears_the_registry() {
    let registry = LaunchRegistry::new(noop(), None);
    registry.get_or_create("p1", "/wt/x");
    registry.stop_all().await;
    assert!(registry.get("p1", "/wt/x").is_none());
}

#[tokio::test]
async fn broadcast_is_shared_across_managers() {
    let events = Arc::new(Mutex::new(Vec::<DaemonEvent>::new()));
    let sink = events.clone();
    let broadcast: BroadcastFn = Arc::new(move |ev| sink.lock().unwrap().push(ev));
    let registry = LaunchRegistry::new(broadcast, None);
    let manager = registry.get_or_create("p1", "/tmp");
    manager
        .start(&mainframe_types::launch::LaunchConfiguration {
            name: "quick".to_string(),
            runtime_executable: "sh".to_string(),
            runtime_args: vec!["-c".to_string(), "exit 0".to_string()],
            port: None,
            url: None,
            preview: Some(false),
            env: None,
        })
        .await
        .unwrap();
    assert!(
        events
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e, DaemonEvent::LaunchStatus { .. }))
    );
    registry.stop_all().await;
}

#[tokio::test]
async fn shutdown_kills_a_launch_preview_tunnel_that_ignores_sigterm() {
    let dir = tempfile::tempdir().unwrap();
    let mut tunnels = TunnelManager::with_config(
        None,
        TunnelConfig {
            cloudflared_bin: write_ready_term_ignoring_cloudflared(dir.path()),
            dns_poll: Duration::from_millis(20),
            dns_timeout: Duration::from_millis(60),
            stop_grace: Duration::from_millis(500),
            ..TunnelConfig::default()
        },
    );
    let (signal, signals) = recording_signal();
    tunnels.set_signal(signal);
    let tunnels = Arc::new(tunnels);
    let (broadcast, events) = recorder();
    let registry = LaunchRegistry::new(broadcast, Some(tunnels.clone()));
    // Accepts connections through its backlog, so the launch's port wait passes.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    registry
        .get_or_create("p1", "/tmp")
        .start(&LaunchConfiguration {
            name: "web".to_string(),
            runtime_executable: "sh".to_string(),
            runtime_args: vec!["-c".to_string(), "sleep 100".to_string()],
            port: Some(i64::from(port)),
            url: None,
            preview: Some(true),
            env: None,
        })
        .await
        .unwrap();
    mainframe_runtime::test_support::poll_until(
        Duration::from_secs(5),
        Duration::from_millis(20),
        async || {
            events
                .lock()
                .unwrap()
                .iter()
                .any(|e| matches!(e, DaemonEvent::LaunchTunnel { .. }))
        },
    )
    .await
    .expect("the preview tunnel should come up");
    let pid = tunnels.pid_of("preview:web").unwrap();

    shutdown_launches_and_tunnels(&registry, &tunnels).await;

    assert_eq!(
        *signals.lock().unwrap(),
        vec![
            (pid, mainframe_runtime::process::Signal::Term),
            (pid, mainframe_runtime::process::Signal::Kill)
        ]
    );
    assert_eq!(tunnels.live_count(), 0);
    assert_eq!(tunnels.get_url("preview:web"), None);
}
