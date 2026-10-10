//! Side-chat lifecycle wiring tests, built on the same real-`ChatManager`
//! harness as `temporary_chat_lifecycle.rs`. No adapter code:
//! `no_persistence_for_spawn` already gives a side chat the no-persistence
//! spawn option once it is temporary (always true) and the adapter reports the
//! capability.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod temporary_chat_lifecycle_support;

use mainframe_db::ChatUpdate;
use mainframe_types::chat::Chat;

use temporary_chat_lifecycle_support as support;

/// A project-scoped, non-temporary parent bound to `worktree_path` (when
/// given), through a direct DB write (like the other harness helpers here).
fn create_parent_with_worktree(h: &support::Harness, worktree_path: Option<&str>) -> Chat {
    let chat = support::create_chat(h, false);
    if let Some(wt) = worktree_path {
        let id = chat.id.clone();
        let wt = wt.to_string();
        h.db.call_blocking(move |d| {
            d.chats.update(
                &id,
                &ChatUpdate {
                    worktree_path: Some(Some(wt)),
                    ..Default::default()
                },
            )
        })
        .unwrap();
    }
    support::get_chat(h, &chat.id)
}

// ── first-spawn cwd priority (`chat_cwd`) ────────────────────────────────────

#[tokio::test]
async fn first_spawn_cwd_prefers_the_parents_worktree() {
    // `enrich_chat`'s directory-missing check (which `open_side_chat` gates
    // on) stats the real filesystem, so the worktree must actually exist.
    let dir = tempfile::TempDir::new().unwrap();
    std::fs::create_dir(dir.path().join(".git")).unwrap();
    let wt = dir.path().to_string_lossy().into_owned();

    let h = support::harness();
    let parent = create_parent_with_worktree(&h, Some(&wt));
    let adapter = support::TestAdapter::new(false);
    let manager = support::rebuild_manager(&h, adapter.clone());

    let side = support::create_side_chat(&manager, &parent.id).await;
    assert_eq!(side.worktree_path.as_deref(), Some(wt.as_str()));

    manager.start_chat(&side.id).await;
    assert_eq!(adapter.project_paths.lock().unwrap().last(), Some(&wt));
}

#[tokio::test]
async fn first_spawn_cwd_falls_back_to_the_project_path_without_a_worktree() {
    let h = support::harness();
    let parent = create_parent_with_worktree(&h, None);
    let adapter = support::TestAdapter::new(false);
    let manager = support::rebuild_manager(&h, adapter.clone());

    let side = support::create_side_chat(&manager, &parent.id).await;
    assert_eq!(side.worktree_path, None);

    manager.start_chat(&side.id).await;
    let project_path = h.data_dir.path().to_string_lossy().into_owned();
    assert_eq!(
        adapter.project_paths.lock().unwrap().last(),
        Some(&project_path)
    );
}

#[tokio::test]
async fn first_spawn_cwd_falls_back_to_the_parents_scratch_directory_for_a_non_project_parent() {
    let h = support::harness();
    let parent = support::create_no_project_chat(&h, false);
    let adapter = support::TestAdapter::new(false);
    let manager = support::rebuild_manager(&h, adapter.clone());

    let side = support::create_side_chat(&manager, &parent.id).await;
    assert!(side.scratch_path.is_some());
    assert_eq!(side.scratch_path, parent.scratch_path);

    manager.start_chat(&side.id).await;
    assert_eq!(
        adapter.project_paths.lock().unwrap().last(),
        side.scratch_path.as_ref()
    );
}

// ── no-persistence spawn option (no adapter code) ───────────────────────────

#[tokio::test]
async fn spawn_carries_no_persistence_exactly_when_the_capability_is_on() {
    let h = support::harness();
    let parent = support::create_chat(&h, false);

    let capable = support::TestAdapter::new(true);
    let manager = support::rebuild_manager(&h, capable.clone());
    let side = support::create_side_chat(&manager, &parent.id).await;
    manager.start_chat(&side.id).await;
    assert_eq!(
        capable.spawn_no_persistence.lock().unwrap().last(),
        Some(&Some(true))
    );

    let h2 = support::harness();
    let parent2 = support::create_chat(&h2, false);
    let not_capable = support::TestAdapter::new(false);
    let manager2 = support::rebuild_manager(&h2, not_capable.clone());
    let side2 = support::create_side_chat(&manager2, &parent2.id).await;
    manager2.start_chat(&side2.id).await;
    assert_ne!(
        not_capable.spawn_no_persistence.lock().unwrap().last(),
        Some(&Some(true)),
        "a non-capable adapter must never see no_persistence: true"
    );
}

// ── empty conversation ("no adapter code") ──────────────────────────────────

#[tokio::test]
async fn the_side_chat_starts_with_no_session_even_after_the_parent_has_one() {
    let h = support::harness();
    let parent = support::create_chat(&h, false);
    let adapter = support::TestAdapter::new(false);
    let manager = support::rebuild_manager(&h, adapter.clone());

    manager.start_chat(&parent.id).await;
    let parent_after_start = support::get_chat(&h, &parent.id);
    assert!(parent_after_start.claude_session_id.is_some());

    let side = support::create_side_chat(&manager, &parent.id).await;
    assert_eq!(side.claude_session_id, None);
    assert_eq!(side.title, None);

    manager.start_chat(&side.id).await;
    let side_after_start = support::get_chat(&h, &side.id);
    assert_ne!(
        side_after_start.claude_session_id, parent_after_start.claude_session_id,
        "the side chat's session must never be the parent's"
    );
}

// ── restart survival ─────────────────────────────────────────────────────────

#[tokio::test]
async fn restart_with_the_capability_on_stamps_loss_mints_a_fresh_id_never_transcript_missing() {
    let h = support::harness();
    let parent = support::create_chat(&h, false);

    let adapter = support::TestAdapter::new(true);
    let manager = support::rebuild_manager(&h, adapter);
    let side = support::create_side_chat(&manager, &parent.id).await;
    manager.start_chat(&side.id).await;

    let after_first_start = support::get_chat(&h, &side.id);
    assert!(after_first_start.vendor_session_ephemeral);
    let first_id = after_first_start
        .claude_session_id
        .clone()
        .expect("on_init must have stored a provider id");
    assert!(after_first_start.context_lost_at.is_none());

    // "Restart": a brand new manager over the same DB — the side chat's row,
    // and its parent relationship, survive; its CLI does not.
    let adapter2 = support::TestAdapter::new(true);
    let manager2 = support::rebuild_manager(&h, adapter2);
    manager2.start_chat(&side.id).await;

    let after_restart = support::get_chat(&h, &side.id);
    assert!(
        after_restart.context_lost_at.is_some(),
        "the dead ephemeral session must be marked lost on the reload"
    );
    let second_id = after_restart
        .claude_session_id
        .clone()
        .expect("the fresh spawn must have stored its own provider id");
    assert_ne!(first_id, second_id, "a fresh spawn must mint a new id");
    assert_ne!(
        after_restart.transcript_missing,
        Some(true),
        "context loss is not the transcript-missing / degraded path"
    );

    // The row and the parent relationship are still there.
    assert_eq!(after_restart.parent_chat_id, Some(Some(parent.id.clone())));
}

#[tokio::test]
async fn restart_with_the_capability_off_resumes_the_same_provider_id() {
    let h = support::harness();
    let parent = support::create_chat(&h, false);

    let adapter = support::TestAdapter::new(false);
    let manager = support::rebuild_manager(&h, adapter);
    let side = support::create_side_chat(&manager, &parent.id).await;
    manager.start_chat(&side.id).await;

    let after_first_start = support::get_chat(&h, &side.id);
    assert!(!after_first_start.vendor_session_ephemeral);
    let first_id = after_first_start
        .claude_session_id
        .clone()
        .expect("on_init must have stored a provider id");

    let adapter2 = support::TestAdapter::new(false);
    let manager2 = support::rebuild_manager(&h, adapter2);
    manager2.start_chat(&side.id).await;

    let after_restart = support::get_chat(&h, &side.id);
    assert!(after_restart.context_lost_at.is_none());
    assert_eq!(after_restart.claude_session_id, Some(first_id));
}

#[tokio::test]
async fn a_restart_before_any_spawn_stamps_no_loss() {
    let h = support::harness();
    let parent = support::create_chat(&h, false);

    let adapter = support::TestAdapter::new(true);
    let manager = support::rebuild_manager(&h, adapter);
    let side = support::create_side_chat(&manager, &parent.id).await;

    // "Restart" before the side chat ever spawned.
    let adapter2 = support::TestAdapter::new(true);
    let manager2 = support::rebuild_manager(&h, adapter2);
    manager2.start_chat(&side.id).await;

    let after_start = support::get_chat(&h, &side.id);
    assert!(
        after_start.context_lost_at.is_none(),
        "a chat that never spawned has nothing to lose"
    );
    assert_ne!(after_start.transcript_missing, Some(true));
}
