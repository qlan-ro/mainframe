use super::*;
use mainframe_runtime::process::is_alive;
use std::process::Stdio;

#[test]
fn invalid_targets_are_rejected() {
    assert!(!default_kill(-1, Signal::Term, false));
    assert!(!default_kill(i64::from(u32::MAX) + 1, Signal::Term, true));
}

#[test]
fn noop_registry_is_a_child_registry_port() {
    fn _accepts(_r: &dyn ChildRegistryPort) {}
    _accepts(&NoopChildRegistry);
}

/// A launch child is reaped as a GROUP: the leader's `kill(-pgid)` must take a
/// non-leader member (the detached `pnpm`/`tsx` tree) with it.
#[tokio::test]
async fn group_kill_takes_a_non_leader_group_member() {
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("member");
    let mut leader = tokio::process::Command::new("/bin/sh")
        .args(["-c", "sleep 60 & echo $! > \"$PID_FILE\"; exec sleep 60"])
        .env("PID_FILE", &pid_file)
        .stdin(Stdio::null())
        .process_group(0)
        .spawn()
        .unwrap();
    let leader_pid = leader.id().unwrap();
    let member: u32 = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(text) = tokio::fs::read_to_string(&pid_file).await
                && let Ok(pid) = text.trim().parse::<u32>()
            {
                break pid;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(is_alive(member));

    assert!(default_kill(i64::from(leader_pid), Signal::Kill, true));

    leader.wait().await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while is_alive(member) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the non-leader group member must die with the group");
}
