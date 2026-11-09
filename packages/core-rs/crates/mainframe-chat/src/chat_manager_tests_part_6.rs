#[tokio::test]
async fn sync_chat_fields_mirrors_tuning_onto_the_cached_active_chat() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), false),
        RecSession::new("c1", false, true),
    );

    mgr.sync_chat_fields(
        "c1",
        ChatPatch {
            tuning: mainframe_types::chat::SessionTuning {
                effort: Some(Some(EffortLevel::High)),
                fast: Some(Some(true)),
                ..Default::default()
            },
            pinned: Some(true),
            ..Default::default()
        },
    );

    let chat = mgr.get_active("c1").unwrap().lock().unwrap().chat.clone();
    assert_eq!(chat.tuning.effort, Some(Some(EffortLevel::High)));
    assert_eq!(chat.tuning.fast, Some(Some(true)));
    assert_eq!(chat.pinned, Some(true));
    // Untouched fields stay unchanged.
    assert_eq!(chat.tuning.ultracode, test_chat("c1").tuning.ultracode);
}

#[tokio::test]
async fn notify_worktree_deleted_emits_only_for_matching_worktree() {
    let mut with_wt = test_chat("c1");
    with_wt.worktree_path = Some("/wt/x".to_string());
    let without = test_chat("c2");
    let project_id = with_wt.project_id.clone();
    let deps = FakeDeps::with_chats(vec![with_wt, without]);
    let mgr = ChatManager::new(deps.clone());

    mgr.notify_worktree_deleted(&project_id, "/wt/x").await;

    let updated: Vec<String> = deps
        .events()
        .into_iter()
        .filter_map(|e| match e {
            DaemonEvent::ChatUpdated { chat, .. } => Some(chat.id),
            _ => None,
        })
        .collect();
    assert_eq!(updated, vec!["c1".to_string()]);
}

#[tokio::test]
async fn add_mention_persists_and_emits_context_updated() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());

    mgr.add_mention(
        "c1",
        SessionMention {
            id: "m1".to_string(),
            kind: MentionKind::File,
            source: MentionSource::User,
            name: "foo.rs".to_string(),
            path: Some("src/foo.rs".to_string()),
            timestamp: "2026-07-10T00:00:00.000Z".to_string(),
        },
    );

    assert_eq!(
        deps.store.mentions.lock().unwrap().as_slice(),
        &[("c1".to_string(), "foo.rs".to_string())]
    );
    assert!(
        deps.events()
            .iter()
            .any(|e| matches!(e, DaemonEvent::ContextUpdated { chat_id, .. } if chat_id == "c1"))
    );
}

#[tokio::test]
async fn get_effective_path_falls_back_to_the_project_root() {
    let deps = FakeDeps::with_chats(vec![test_chat("c1")]);
    let mgr = ChatManager::new(deps);
    // test_chat has no worktree → project root from projects_get_path.
    assert_eq!(mgr.get_effective_path("c1").as_deref(), Some("/tmp/test"));
    assert_eq!(mgr.get_effective_path("missing"), None);
}

#[tokio::test]
async fn get_messages_is_empty_without_a_claude_session() {
    let deps = FakeDeps::with_chats(vec![test_chat("c1")]);
    let mgr = ChatManager::new(deps);
    assert!(mgr.get_messages("c1").await.is_empty());
}

/// The adapter refuses the turn before it starts (Codex rejecting
/// `thread/resume` for a thread archived in Codex). No result will ever
/// arrive, so the chat must not stay Working, and the never-delivered message
/// must not sit in the transcript beside the client's failed-send bubble.
#[tokio::test]
async fn a_send_the_adapter_refuses_restores_idle_and_drops_the_message() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", false, true);
    *session.send_err.lock().unwrap() = Some("session t1 is archived".to_string());
    seed_active(&mgr, "c1", working_chat("c1", Some("t"), false), session.clone());

    let err = mgr.send_message("c1", "continue", None, None).await;

    assert_eq!(
        err.unwrap_err().to_string(),
        "session t1 is archived"
    );
    let chat = mgr.get_active("c1").unwrap().lock().unwrap().chat.clone();
    assert_eq!(chat.process_state, Some(Some(ProcessState::Idle)));
    let last_patch = deps
        .store
        .updates
        .lock()
        .unwrap()
        .iter()
        .rev()
        .find_map(|(_, patch)| patch.process_state)
        .expect("the rollback persists a process state");
    assert_eq!(last_patch, Some(ProcessState::Idle));
    assert!(
        mgr.get_messages("c1").await.is_empty(),
        "a refused send must not leave the undelivered message in the transcript"
    );
}
