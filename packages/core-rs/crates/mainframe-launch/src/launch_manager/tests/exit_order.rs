use super::*;
use crate::tunnel_manager::{TunnelConfig, TunnelManager};
use mainframe_runtime::process::{PUMP_DRAIN_GRACE, Signal, Target, signal};

/// Kills a launch leader's process group (and the grandchild left in it) when
/// the test ends, pass or fail.
struct KillGroupOnDrop(u32);

impl Drop for KillGroupOnDrop {
    fn drop(&mut self) {
        let _ = signal(Target::Group(self.0), Signal::Kill); /* expected: the group may be gone */
    }
}

fn registered(manager: &LaunchManager, name: &str) -> (u32, watch::Receiver<bool>) {
    let entry = manager.inner.processes.get(name).expect("registered");
    (entry.pid.expect("spawned pid"), entry.exit_rx.clone())
}

async fn wait_exited(exit_rx: &mut watch::Receiver<bool>) {
    tokio::time::timeout(Duration::from_secs(5), wait_until_exited(exit_rx))
        .await
        .expect("exit published once the leader is reaped");
}

/// The leader exits while a grandchild keeps the stdio pipes open. The process
/// entry must go (and `exit_rx` fire) as soon as the leader is reaped, before
/// the pumps finish; the terminal status follows the pumps' last chunk.
#[tokio::test]
async fn retires_the_process_entry_before_the_pumps_drain_and_emits_status_after() {
    let dir = tempfile::tempdir().unwrap();
    let go = dir.path().join("go");
    let (events, log) = recorder();
    let manager = manager(events);
    // The grandchild writes its last line only once the test creates `go`.
    let script = format!(
        "(while [ ! -e '{}' ]; do sleep 0.01; done; echo late) & exit 0",
        go.display()
    );
    manager.start(&cfg("dev", &script, None)).await.unwrap();
    let (pid, mut exit_rx) = registered(&manager, "dev");
    let _group = KillGroupOnDrop(pid);

    wait_exited(&mut exit_rx).await;
    assert!(
        !manager.inner.processes.contains_key("dev"),
        "entry retired with the exit, while the grandchild still holds the pipes"
    );
    std::fs::write(&go, b"").unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        while manager.get_status("dev") != LaunchProcessStatus::Stopped {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("terminal status emitted after the drain");
    let events = log.lock().unwrap();
    let position = |predicate: &dyn Fn(&DaemonEvent) -> bool| {
        events.iter().position(predicate).expect("event recorded")
    };
    let late = position(
        &|e| matches!(e, DaemonEvent::LaunchOutput { name, data, .. } if name == "dev" && data.contains("late")),
    );
    let stopped = position(
        &|e| matches!(e, DaemonEvent::LaunchStatus { name, status: LaunchProcessStatus::Stopped, .. } if name == "dev"),
    );
    assert!(
        late < stopped,
        "the grandchild's output written after the reap precedes the terminal status"
    );
}

/// A start of the same name while the previous process's pumps still drain
/// owns the name: the old exit task must neither overwrite the new process's
/// status nor stop the preview tunnel the new process now uses.
#[tokio::test]
async fn a_restart_during_the_drain_keeps_its_status_and_preview_tunnel() {
    let dir = tempfile::tempdir().unwrap();
    let tunnels = Arc::new(TunnelManager::with_config(
        None,
        TunnelConfig {
            cloudflared_bin: crate::test_support::write_fake_cloudflared(dir.path()),
            dns_poll: Duration::from_millis(20),
            dns_timeout: Duration::from_millis(60),
            ..TunnelConfig::default()
        },
    ));
    let (events, log) = recorder();
    let manager = LaunchManager::new("proj-1", "/tmp", events, Some(tunnels.clone()), None, None);

    // The grandchild holds the pipes, so the old exit task drains for the
    // full PUMP_DRAIN_GRACE after the leader is reaped.
    manager
        .start(&cfg("dev", "sleep 60 & exit 0", None))
        .await
        .unwrap();
    let (old_pid, mut old_exit) = registered(&manager, "dev");
    let _old_group = KillGroupOnDrop(old_pid);
    wait_exited(&mut old_exit).await;

    manager
        .start(&cfg("dev", "exec sleep 60", None))
        .await
        .unwrap();
    let (new_pid, _) = registered(&manager, "dev");
    let _new_group = KillGroupOnDrop(new_pid);
    assert_ne!(new_pid, old_pid);
    assert_eq!(manager.get_status("dev"), LaunchProcessStatus::Running);
    let url = tunnels.start(3000, "preview:dev", None).await.unwrap();
    let restarted_at = log.lock().unwrap().len();

    // Both old pumps give up after PUMP_DRAIN_GRACE each; then the old exit
    // task has had its chance to touch the name.
    tokio::time::sleep(PUMP_DRAIN_GRACE * 3).await;

    assert_eq!(manager.get_status("dev"), LaunchProcessStatus::Running);
    let later_statuses: Vec<_> = log.lock().unwrap()[restarted_at..]
        .iter()
        .filter_map(|e| match e {
            DaemonEvent::LaunchStatus { name, status, .. } => Some((name.clone(), *status)),
            _ => None,
        })
        .collect();
    assert_eq!(later_statuses, vec![], "the old exit task emitted a status");
    assert_eq!(tunnels.get_url("preview:dev"), Some(url));
    tunnels.stop("preview:dev").await;
}
