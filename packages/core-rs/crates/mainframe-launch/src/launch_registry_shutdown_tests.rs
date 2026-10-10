use super::*;
use crate::test_support::recorder;
use mainframe_types::{
    events::DaemonEvent,
    launch::{LaunchConfiguration, LaunchProcessStatus},
};
use std::future::Future;

fn noop() -> BroadcastFn {
    Arc::new(|_| {})
}

#[tokio::test]
async fn shutdown_rejects_existing_and_new_launch_managers() {
    let registry = LaunchRegistry::new(noop(), None);
    let existing = registry.get_or_create("p1", "/tmp");
    let tunnels = TunnelManager::new(None);
    shutdown_launches_and_tunnels(&registry, &tunnels).await;
    let config = LaunchConfiguration {
        name: "late".to_string(),
        runtime_executable: "sh".to_string(),
        runtime_args: vec!["-c".to_string(), "exit 0".to_string()],
        port: None,
        url: None,
        preview: Some(false),
        env: None,
    };
    for manager in [existing, registry.get_or_create("p2", "/tmp")] {
        assert!(matches!(
            manager.start(&config).await,
            Err(crate::LaunchError::ShuttingDown)
        ));
    }
}

#[tokio::test]
async fn concurrent_starts_waiting_on_the_gate_register_only_one_child() {
    let (broadcast, events) = recorder();
    let registry = Arc::new(LaunchRegistry::new(broadcast, None));
    let manager = registry.get_or_create("p1", "/tmp");
    let gate = registry.spawn_gate.lock().await;
    let config = LaunchConfiguration {
        name: "same".to_string(),
        runtime_executable: "sh".to_string(),
        runtime_args: vec!["-c".to_string(), "sleep 2".to_string()],
        port: None,
        url: None,
        preview: Some(false),
        env: None,
    };
    let first = manager.start(&config);
    let second = manager.start(&config);
    tokio::pin!(first, second);
    std::future::poll_fn(|cx| {
        assert!(first.as_mut().poll(cx).is_pending());
        assert!(second.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    drop(gate);
    let (first, second) = tokio::join!(first, second);
    first.unwrap();
    second.unwrap();
    registry.stop_all().await;
    let starting = events
        .lock()
        .unwrap()
        .iter()
        .filter(|event| {
            matches!(
                event,
                DaemonEvent::LaunchStatus {
                    status: LaunchProcessStatus::Starting,
                    ..
                }
            )
        })
        .count();
    assert_eq!(starting, 1);
}

#[tokio::test]
async fn shutdown_stops_multiple_launch_groups_within_shell_deadline() {
    let (broadcast, events) = recorder();
    let registry = LaunchRegistry::new(broadcast, None);
    for project in ["p1", "p2"] {
        for name in ["web", "api"] {
            registry
                .get_or_create(project, "/tmp")
                .start(&LaunchConfiguration {
                    name: name.to_string(),
                    runtime_executable: "sh".to_string(),
                    runtime_args: vec![
                        "-c".to_string(),
                        "trap '' TERM; echo trapped:$$; exec sleep 30".to_string(),
                    ],
                    port: None,
                    url: None,
                    preview: Some(false),
                    env: None,
                })
                .await
                .unwrap();
        }
    }
    let pids = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let pids = trapped_pids(&events);
            if pids.len() == 4 {
                break pids;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    tokio::time::timeout(
        std::time::Duration::from_secs(8),
        shutdown_launches_and_tunnels(&registry, &TunnelManager::new(None)),
    )
    .await
    .expect("all groups must exit before the shell deadline");
    for pid in pids {
        assert!(crate::process::default_process_command(pid).await.is_none());
    }
}

fn trapped_pids(events: &std::sync::Mutex<Vec<DaemonEvent>>) -> Vec<i64> {
    events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|event| {
            let DaemonEvent::LaunchOutput { data, .. } = event else {
                return None;
            };
            data.trim().strip_prefix("trapped:")?.parse().ok()
        })
        .collect()
}
