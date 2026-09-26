//! `ChatManager::sweep_unreferenced_fork_snapshots` (todo #343 Group 3, plan
//! item 5) — the daemon-startup sweep that removes a snapshot directory no
//! chat's `pending_fork` references. A child module of `tests`, so it sees
//! `tests`' private `StoreDeps`.

use super::*;

fn pending_for(snapshot_dir: &str) -> PendingForkState {
    PendingForkState {
        fork_source: ForkSource {
            source_session_id: "parent-session".to_string(),
            resume_path: Some(format!("{snapshot_dir}/parent-session.jsonl")),
        },
        snapshot_dir: snapshot_dir.to_string(),
        provisional_title: "Untitled (fork)".to_string(),
    }
}

#[tokio::test]
async fn removes_a_snapshot_dir_no_chat_references() {
    let root = tempfile::tempdir().unwrap();
    let orphan = root.path().join("orphan-1");
    std::fs::create_dir_all(&orphan).unwrap();

    let deps = StoreDeps::arc();
    deps.set_fork_snapshots_dir(&root.path().to_string_lossy());
    let mgr = ChatManager::new(deps);

    mgr.sweep_unreferenced_fork_snapshots().await;

    assert!(!orphan.exists());
}

#[tokio::test]
async fn keeps_a_snapshot_dir_a_pending_fork_still_references() {
    let root = tempfile::tempdir().unwrap();
    let kept = root.path().join("kept-1");
    std::fs::create_dir_all(&kept).unwrap();
    let kept_str = kept.to_string_lossy().into_owned();

    let mut chat = test_chat("fork-1");
    chat.claude_session_id = None;
    let deps = StoreDeps::with_chats(vec![chat]);
    deps.set_fork_snapshots_dir(&root.path().to_string_lossy());
    deps.set_pending_fork("fork-1", pending_for(&kept_str));
    let mgr = ChatManager::new(deps);

    mgr.sweep_unreferenced_fork_snapshots().await;

    assert!(kept.exists());
}

/// A never-pinned installation (the directory doesn't exist yet) is a silent
/// no-op, not a failure.
#[tokio::test]
async fn a_missing_snapshots_root_is_a_no_op() {
    let root = tempfile::tempdir().unwrap();
    let missing_root = root.path().join("never-created");

    let deps = StoreDeps::arc();
    deps.set_fork_snapshots_dir(&missing_root.to_string_lossy());
    let mgr = ChatManager::new(deps);

    mgr.sweep_unreferenced_fork_snapshots().await;
}
