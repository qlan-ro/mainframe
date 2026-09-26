//! `assign_initial_title`'s fork carve-out (todo #343 Group 3, plan item 4): a
//! fork's provisional title still triggers generation on the first send, even
//! though it is non-empty, but a rename before that first message wins. A
//! child module of `tests`, so it sees `tests`' private `StoreDeps`/`RecSession`/
//! `seed_active`/`title_cmd_manager`.

use super::*;

const PROVISIONAL: &str = "Fix the flaky test (fork)";

fn fork_pending() -> PendingForkState {
    PendingForkState {
        fork_source: ForkSource {
            source_session_id: "parent-session".to_string(),
            resume_path: Some("/tmp/fork-snapshots/n1/parent-session.jsonl".to_string()),
        },
        snapshot_dir: "/tmp/fork-snapshots/n1".to_string(),
        provisional_title: PROVISIONAL.to_string(),
    }
}

/// A fork's first send generates a title even though `title_empty` is false —
/// otherwise the provisional `(fork)` title would never be replaced.
#[tokio::test]
async fn a_forks_first_message_replaces_the_provisional_title_with_the_generated_one() {
    let (mgr, deps, _session) = title_cmd_manager(Some(PROVISIONAL));
    deps.set_pending_fork("chat-1", fork_pending());
    *deps.generated_title.lock().unwrap() = Some("Fix the actually flaky test".to_string());

    mgr.send_message("chat-1", "Let's dig in", None, None)
        .await
        .unwrap();
    settle().await;

    assert_eq!(
        deps.chats_get("chat-1").unwrap().title,
        Some("Fix the actually flaky test".to_string())
    );
    assert_eq!(deps.generate_title_calls.lock().unwrap().len(), 1);
}

/// Generation producing nothing (disabled, or no title) leaves the provisional
/// title exactly as `create_fork` stored it.
#[tokio::test]
async fn a_forks_provisional_title_stays_when_generation_produces_nothing() {
    let (mgr, deps, _session) = title_cmd_manager(Some(PROVISIONAL));
    deps.set_pending_fork("chat-1", fork_pending());
    // `deps.generated_title` defaults to `None`.

    mgr.send_message("chat-1", "Let's dig in", None, None)
        .await
        .unwrap();
    settle().await;

    assert_eq!(
        deps.chats_get("chat-1").unwrap().title,
        Some(PROVISIONAL.to_string())
    );
}

/// A rename before the first message (the stored title no longer equals the
/// provisional one) is kept — no generated title ever replaces it.
#[tokio::test]
async fn a_rename_before_the_first_message_is_never_regenerated() {
    let (mgr, deps, _session) = title_cmd_manager(Some("My custom title"));
    deps.set_pending_fork("chat-1", fork_pending());
    *deps.generated_title.lock().unwrap() = Some("Should never apply".to_string());

    mgr.send_message("chat-1", "Let's dig in", None, None)
        .await
        .unwrap();
    settle().await;

    assert_eq!(
        deps.chats_get("chat-1").unwrap().title,
        Some("My custom title".to_string())
    );
    assert!(deps.generate_title_calls.lock().unwrap().is_empty());
}

/// A non-fork chat (no pending fork at all) is unaffected: an already-titled
/// chat's first send never triggers generation, matching pre-existing behavior.
#[tokio::test]
async fn a_non_fork_titled_chat_is_unaffected() {
    let (mgr, deps, _session) = title_cmd_manager(Some("Test chat"));

    mgr.send_message("chat-1", "Let's dig in", None, None)
        .await
        .unwrap();
    settle().await;

    assert_eq!(
        deps.chats_get("chat-1").unwrap().title,
        Some("Test chat".to_string())
    );
    assert!(deps.generate_title_calls.lock().unwrap().is_empty());
}
