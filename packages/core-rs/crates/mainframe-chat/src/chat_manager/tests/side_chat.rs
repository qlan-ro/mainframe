//! `ChatManager::open_side_chat`, its discard path, and the archive cascade
//! (— daemon-side-chats). A child module of `tests`, so
//! it sees `tests`' private `StoreDeps`.
use super::*;

fn parent_chat(id: &str) -> Chat {
    // `enrich_chat`'s directory-missing check stats the real filesystem against
    // StoreDeps's fixed "/tmp/test" project path — make sure it exists so every
    // test below is about open_side_chat's OWN gating, not directory presence.
    std::fs::create_dir_all("/tmp/test").expect("create the fake project dir");
    let mut c = test_chat(id);
    c.status = ChatStatus::Active;
    c
}

fn fake_worktree() -> (tempfile::TempDir, String) {
    let dir = tempfile::TempDir::new().unwrap();
    std::fs::create_dir(dir.path().join(".git")).unwrap();
    let path = dir.path().to_string_lossy().into_owned();
    (dir, path)
}

// ── refusals (rule 3) ────────────────────────────────────────────────────────

#[tokio::test]
async fn unknown_parent_is_not_found() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps);
    let err = mgr.open_side_chat("nope").await.unwrap_err();
    assert_eq!(err, OpenSideChatError::NotFound("nope".to_string()));
    assert_eq!(err.status_code(), 404);
}

#[tokio::test]
async fn an_archived_parent_is_refused_409() {
    let mut chat = parent_chat("c1");
    chat.status = ChatStatus::Archived;
    let deps = StoreDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps);
    let err = mgr.open_side_chat("c1").await.unwrap_err();
    assert_eq!(err, OpenSideChatError::Archived);
    assert_eq!(err.status_code(), 409);
}

#[tokio::test]
async fn a_side_chat_cannot_open_its_own_side_chat_409() {
    let mut chat = parent_chat("c1");
    chat.temporary = true;
    chat.parent_chat_id = Some(Some("parent-of-c1".to_string()));
    let deps = StoreDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps);
    let err = mgr.open_side_chat("c1").await.unwrap_err();
    assert_eq!(err, OpenSideChatError::ParentIsSideChat);
    assert_eq!(err.status_code(), 409);
}

#[tokio::test]
async fn a_missing_directory_is_refused_409() {
    let mut chat = parent_chat("c1");
    chat.worktree_path = Some("/tmp/definitely-not-a-real-side-chat-worktree".to_string());
    let deps = StoreDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps);
    let err = mgr.open_side_chat("c1").await.unwrap_err();
    assert_eq!(err, OpenSideChatError::DirectoryMissing);
    assert_eq!(err.status_code(), 409);
}

// A temporary parent and a non-project parent are both allowed.
#[tokio::test]
async fn a_temporary_non_side_chat_parent_may_open_a_side_chat() {
    let mut chat = parent_chat("c1");
    chat.temporary = true;
    let deps = StoreDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps);
    assert!(mgr.open_side_chat("c1").await.is_ok());
}

// ── open / reveal (rule 1, AC 9) ─────────────────────────────────────────────

#[tokio::test]
async fn the_side_chat_starts_empty_temporary_and_parented() {
    let mut chat = parent_chat("c1");
    chat.model = Some("claude-opus".to_string());
    let deps = StoreDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps);

    let side = mgr.open_side_chat("c1").await.expect("open should succeed");
    assert!(side.temporary);
    assert_eq!(side.parent_chat_id, Some(Some("c1".to_string())));
    assert_eq!(side.model, Some("claude-opus".to_string()));
    assert_eq!(side.title, None);
    assert_eq!(side.pinned, None);
}

#[tokio::test]
async fn opening_twice_reveals_the_existing_side_chat_rather_than_minting_a_second() {
    let chat = parent_chat("c1");
    let deps = StoreDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps.clone());

    let first = mgr.open_side_chat("c1").await.expect("first open");
    let before = deps.chat_count();
    let second = mgr
        .open_side_chat("c1")
        .await
        .expect("second open (reveal)");

    assert_eq!(second.id, first.id);
    assert_eq!(deps.chat_count(), before);
}

// ── events (rule 4, wire contract) ───────────────────────────────────────────

#[tokio::test]
async fn opening_emits_chat_updated_for_the_parent_never_chat_created_for_the_side_chat() {
    let chat = parent_chat("c1");
    let deps = StoreDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps.clone());

    let side = mgr.open_side_chat("c1").await.expect("open should succeed");

    assert!(deps.events().iter().any(|e| matches!(
        e,
        DaemonEvent::ChatUpdated { chat, .. }
            if chat.id == "c1" && chat.side_chat_id.as_deref() == Some(side.id.as_str())
    )));
    assert!(
        !deps
            .events()
            .iter()
            .any(|e| matches!(e, DaemonEvent::ChatCreated { chat, .. } if chat.id == side.id))
    );
}

// ── discard (rule 5, AC 8) ───────────────────────────────────────────────────

#[tokio::test]
async fn discarding_the_side_chat_deletes_its_row_and_leaves_the_parents_scratch_directory() {
    let chat = parent_chat("c1");
    let deps = StoreDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps.clone());
    let side = mgr.open_side_chat("c1").await.expect("open should succeed");

    mgr.discard_chat(&side.id)
        .await
        .expect("discard should succeed");

    assert!(mgr.get_chat(&side.id).is_none());
    assert!(deps.remove_scratch_dir_calls.lock().unwrap().is_empty());

    // A subsequent open starts empty again (a fresh row, not the discarded one).
    let reopened = mgr
        .open_side_chat("c1")
        .await
        .expect("reopen should succeed");
    assert_ne!(reopened.id, side.id);
}

#[tokio::test]
async fn discarding_the_side_chat_never_sweeps_its_shared_worktree() {
    let (_dir, wt) = fake_worktree();
    let mut chat = parent_chat("c1");
    chat.worktree_path = Some(wt.clone());
    let deps = StoreDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps.clone());
    let side = mgr.open_side_chat("c1").await.expect("open should succeed");
    assert_eq!(side.worktree_path.as_deref(), Some(wt.as_str()));

    mgr.discard_chat(&side.id)
        .await
        .expect("discard should succeed");

    assert!(
        deps.order()
            .iter()
            .any(|e| e == &format!("kill:{}:no-wt", side.id))
    );
}

#[tokio::test]
async fn discarding_a_temporary_parent_discards_its_side_chat_first() {
    let mut chat = parent_chat("c1");
    chat.temporary = true;
    let deps = StoreDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps);
    let side = mgr.open_side_chat("c1").await.expect("open should succeed");

    mgr.discard_chat("c1")
        .await
        .expect("discard should succeed");

    assert!(mgr.get_chat("c1").is_none());
    assert!(mgr.get_chat(&side.id).is_none());
}

// ── archive cascade (rule 6, AC 7) ───────────────────────────────────────────

#[tokio::test]
async fn archiving_a_parent_discards_its_side_chat_before_the_lifecycle_archive_runs() {
    let (_dir, wt) = fake_worktree();
    let mut chat = parent_chat("c1");
    chat.worktree_path = Some(wt.clone());
    let deps = StoreDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps.clone());
    let side = mgr.open_side_chat("c1").await.expect("open should succeed");

    mgr.archive_chat("c1", true).await;

    assert!(mgr.get_chat(&side.id).is_none());
    let order = deps.order();
    let side_kill = order
        .iter()
        .position(|e| e.starts_with(&format!("kill:{}:", side.id)));
    let parent_kill = order.iter().position(|e| e.starts_with("kill:c1:"));
    assert!(
        side_kill.is_some(),
        "side chat teardown never ran: {order:?}"
    );
    assert!(
        parent_kill.is_some(),
        "parent teardown never ran: {order:?}"
    );
    assert!(side_kill.unwrap() < parent_kill.unwrap());
}

// ── waiting enrichment (rule 9, AC 21) ───────────────────────────────────────

#[tokio::test]
async fn side_chat_waiting_follows_a_pending_gate_on_the_side_chat_not_the_parent() {
    let chat = parent_chat("c1");
    let deps = StoreDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps);
    let side = mgr.open_side_chat("c1").await.expect("open should succeed");

    let idle = mgr.get_chat("c1").unwrap();
    assert_eq!(idle.side_chat_waiting, Some(false));

    mgr.permissions.lock().unwrap().enqueue(
        &side.id,
        mainframe_types::adapter::ControlRequest {
            request_id: "req-1".to_string(),
            tool_name: "Bash".to_string(),
            tool_use_id: "tu-1".to_string(),
            input: std::collections::HashMap::new(),
            suggestions: Vec::new(),
            decision_reason: None,
            options: None,
        },
    );

    let waiting = mgr.get_chat("c1").unwrap();
    assert_eq!(waiting.side_chat_waiting, Some(true));
    // The parent's own status is unaffected by its side chat's gate — the UI's
    // fork gating reads `hasPending`, which must stay the parent's own value.
    assert_ne!(waiting.display_status, Some(DisplayStatus::Waiting));
}
