use super::*;
use mainframe_runtime::process::{Signal, Target, signal};

/// The leader exits while a grandchild keeps the stdio pipes open. The process
/// entry must go (and `exit_rx` fire) as soon as the leader is reaped, before
/// the pumps give up on the held pipes; the terminal status follows the drain.
#[tokio::test]
async fn retires_the_process_entry_before_the_pumps_drain_and_emits_status_after() {
    let (events, log) = recorder();
    let manager = manager(events);
    manager
        .start(&cfg("dev", "sleep 60 & exit 0", None))
        .await
        .unwrap();
    let (pid, mut exit_rx) = {
        let entry = manager.inner.processes.get("dev").expect("registered");
        (entry.pid.unwrap(), entry.exit_rx.clone())
    };

    tokio::time::timeout(Duration::from_secs(5), wait_until_exited(&mut exit_rx))
        .await
        .expect("exit published once the leader is reaped");
    assert!(
        !manager.inner.processes.contains_key("dev"),
        "entry retired with the exit"
    );
    assert!(
        !status_events(&log).contains(&("dev".to_string(), LaunchProcessStatus::Stopped)),
        "status waits for the pump drain (bounded, well after the exit)"
    );

    tokio::time::timeout(Duration::from_secs(5), async {
        while !status_events(&log).contains(&("dev".to_string(), LaunchProcessStatus::Stopped)) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("terminal status still emitted after the drain");
    assert_eq!(manager.get_status("dev"), LaunchProcessStatus::Stopped);

    // The orphaned grandchild shares the leader's group; reap it.
    let _ = signal(Target::Group(pid), Signal::Kill);
}
