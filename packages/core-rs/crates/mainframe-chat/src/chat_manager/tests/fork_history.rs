//! `build_history_session` learns the pending fork (todo #343 Group 3, plan
//! item 3) — AC 1's "history before the first message" path: a freshly forked
//! chat has no `claude_session_id` yet, so its history load must resume from
//! `chats.pending_fork` instead of bailing out early. A child module of
//! `tests`, so it sees `tests`' private `StoreDeps`.

use super::*;

fn unsent_fork(id: &str) -> Chat {
    let mut c = test_chat(id);
    c.claude_session_id = None;
    c.parent_chat_id = Some(Some("parent-1".to_string()));
    c
}

fn fork_source() -> ForkSource {
    ForkSource {
        source_session_id: "parent-session".to_string(),
        resume_path: Some("/tmp/fork-snapshots/n1/parent-session.jsonl".to_string()),
    }
}

#[tokio::test]
async fn an_unsent_forks_history_resumes_from_the_pending_fork_source() {
    let deps = StoreDeps::with_chats(vec![unsent_fork("fork-1")]);
    deps.set_pending_fork(
        "fork-1",
        PendingForkState {
            fork_source: fork_source(),
            snapshot_dir: "/tmp/fork-snapshots/n1".to_string(),
            provisional_title: "Untitled (fork)".to_string(),
        },
    );
    *deps.history.lock().unwrap() = Some(vec![history_message()]);
    let mgr = ChatManager::new(deps);

    let messages = mgr.get_messages("fork-1").await;

    assert_eq!(messages.len(), 1);
    // `remap_history` rewrites the embedded Claude sessionId back to the
    // Mainframe chat id.
    assert_eq!(messages[0].chat_id, "fork-1");
}

/// A chat with neither its own session nor a pending fork has nothing to
/// resume — the pre-existing "no history" behavior must be unchanged.
#[tokio::test]
async fn a_chat_with_no_session_and_no_pending_fork_has_no_history() {
    let deps = StoreDeps::with_chats(vec![unsent_fork("c1")]);
    *deps.history.lock().unwrap() = Some(vec![history_message()]);
    let mgr = ChatManager::new(deps);

    assert!(mgr.get_messages("c1").await.is_empty());
}
