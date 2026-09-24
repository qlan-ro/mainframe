//! Todo #346 (G2b) — wiring-level tests for the scratch cwd, the no-persistence
//! spawn decision, context loss, and reconciliation, built on a real
//! `ChatManager` (`build_chat_manager`) rather than a hand-built deps fake, per
//! the `transcript_presence_wiring.rs` template.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod temporary_chat_lifecycle_support;

use temporary_chat_lifecycle_support as support;

/// A capability-on temporary chat: a restart drops the resume target (marking
/// the loss) and spawns fresh with a new provider id; a capability-off
/// temporary chat instead resumes the same id, unaffected by the restart.
#[tokio::test]
async fn restart_survival_marks_context_loss_and_spawns_fresh_when_capable() {
    let h = support::harness();
    let chat = support::create_chat(&h, true);

    let adapter = support::TestAdapter::new(true);
    let manager = support::rebuild_manager(&h, adapter.clone());
    manager.start_chat(&chat.id).await;

    let after_first_start = support::get_chat(&h, &chat.id);
    assert!(after_first_start.vendor_session_ephemeral);
    let first_id = after_first_start
        .claude_session_id
        .clone()
        .expect("on_init must have stored a provider id");
    assert!(after_first_start.context_lost_at.is_none());

    // "Restart": a brand new manager over the same DB, active-chat registry empty.
    let adapter2 = support::TestAdapter::new(true);
    let manager2 = support::rebuild_manager(&h, adapter2);
    manager2.start_chat(&chat.id).await;

    let after_restart = support::get_chat(&h, &chat.id);
    assert!(
        after_restart.context_lost_at.is_some(),
        "the dead ephemeral session must be marked lost on the reload"
    );
    let second_id = after_restart
        .claude_session_id
        .expect("the fresh spawn must have stored its own provider id");
    assert_ne!(first_id, second_id, "a fresh spawn must mint a new id");
}

#[tokio::test]
async fn restart_survival_resumes_the_same_id_without_the_capability() {
    let h = support::harness();
    let chat = support::create_chat(&h, true); // temporary, but the adapter never reports the capability

    let adapter = support::TestAdapter::new(false);
    let manager = support::rebuild_manager(&h, adapter);
    manager.start_chat(&chat.id).await;

    let after_first_start = support::get_chat(&h, &chat.id);
    assert!(!after_first_start.vendor_session_ephemeral);
    let first_id = after_first_start
        .claude_session_id
        .clone()
        .expect("on_init must have stored a provider id");

    let adapter2 = support::TestAdapter::new(false);
    let manager2 = support::rebuild_manager(&h, adapter2);
    manager2.start_chat(&chat.id).await;

    let after_restart = support::get_chat(&h, &chat.id);
    assert!(
        after_restart.context_lost_at.is_none(),
        "a normally-persisted session is never marked lost"
    );
    assert_eq!(
        after_restart.claude_session_id,
        Some(first_id),
        "without the capability the chat resumes its stored session id"
    );
}

/// Rule 7's reconciliation early-return, exercised through the same
/// `ChatManager::reconcile_transcript` wiring the history route uses (real
/// `DaemonChatDeps`, not the pure-function fake in `mainframe-chat`).
#[tokio::test]
async fn reconciliation_skips_a_vendor_ephemeral_chat() {
    let h = support::harness();
    let chat = support::create_chat(&h, true);
    let adapter = support::TestAdapter::new(true);
    let manager = support::rebuild_manager(&h, adapter);
    manager.start_chat(&chat.id).await;

    let mut loaded = support::get_chat(&h, &chat.id);
    assert!(loaded.vendor_session_ephemeral);
    let before = loaded.transcript_missing;
    let missing = manager.reconcile_transcript(&mut loaded).await;
    assert!(!missing);
    // Rule 7's early return: the persisted flag is left exactly as it was,
    // not (re)computed from a transcript-presence check.
    let after = support::get_chat(&h, &chat.id);
    assert_eq!(after.transcript_missing, before);
}

/// A non-project chat's cwd is its scratch path, created lazily on first
/// start, stable across a restart, and recreated if deleted since.
#[tokio::test]
async fn non_project_scratch_cwd_is_lazy_stable_and_recreated_when_deleted() {
    let h = support::harness();
    let chat = support::create_no_project_chat(&h, false);
    let scratch_path = chat
        .scratch_path
        .clone()
        .expect("a non-project chat always has a scratch path");
    assert!(
        !std::path::Path::new(&scratch_path).exists(),
        "nothing is created on disk before the first send"
    );

    let adapter = support::TestAdapter::new(false);
    let manager = support::rebuild_manager(&h, adapter.clone());
    manager.start_chat(&chat.id).await;

    assert!(
        std::path::Path::new(&scratch_path).exists(),
        "the first start creates the scratch directory"
    );
    // The session was created against the scratch path, not a project path.
    assert_eq!(
        adapter.project_paths.lock().unwrap().as_slice(),
        std::slice::from_ref(&scratch_path)
    );

    std::fs::remove_dir_all(&scratch_path).unwrap();
    assert!(!std::path::Path::new(&scratch_path).exists());

    // "Restart", then start again — the same path must be recreated.
    let adapter2 = support::TestAdapter::new(false);
    let manager2 = support::rebuild_manager(&h, adapter2);
    manager2.start_chat(&chat.id).await;

    assert!(
        std::path::Path::new(&scratch_path).exists(),
        "a deleted scratch directory is recreated on the next start"
    );
    let after_restart = support::get_chat(&h, &chat.id);
    assert_eq!(
        after_restart.scratch_path.as_deref(),
        Some(scratch_path.as_str()),
        "the scratch path itself never moves across a restart"
    );
}
