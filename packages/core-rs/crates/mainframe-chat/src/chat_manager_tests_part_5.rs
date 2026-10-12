#[tokio::test]
async fn command_first_fallback_survives_a_generation_that_returns_nothing() {
    let (mgr, deps, _session) = title_cmd_manager(None);

    mgr.send_message(
        "chat-1",
        "/compact",
        None,
        Some(CommandMeta {
            name: "compact".to_string(),
            source: "claude".to_string(),
            args: None,
        }),
    )
    .await
    .unwrap();
    settle().await;

    assert_eq!(
        deps.chats_get("chat-1").unwrap().unwrap().title,
        Some("/compact".to_string())
    );
    assert_eq!(deps.adapters.generate_title_calls.lock().unwrap().len(), 1);
    assert_eq!(titles_written(&deps), vec!["/compact".to_string()]);
}

#[tokio::test]
async fn plain_text_with_attachments_keeps_prefix_images_and_transient_metadata() {
    let deps = FakeDeps::arc();
    *deps.workspace.attachments.lock().unwrap() = Some(ProcessedAttachments {
        images: vec![ImageInput {
            media_type: "image/png".to_string(),
            data: "AAA".to_string(),
            path: None,
        }],
        message_content: vec![MessageContent::Leaf(LeafContent::Text {
            text: "[Image: shot.png]".to_string(),
            parent_tool_use_id: None,
        })],
        text_prefix: vec!["prefix".to_string()],
        attachment_previews: vec![serde_json::json!({ "id": "att-1" })],
    });
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", true, true);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );

    let ids = vec!["att-1".to_string()];
    mgr.send_message("c1", "hello", Some(&ids), None)
        .await
        .unwrap();

    let sent_uuid = {
        let calls = session.send_message_calls.lock().unwrap();
        assert_eq!(calls[0].0, "prefix\n\nhello");
        calls[0].1.clone()
    };
    assert_eq!(session.images_calls.lock().unwrap()[0], 1);

    let added = mgr.get_messages("c1").await;
    assert_eq!(added.len(), 1);
    let msg = &added[0];
    let texts: Vec<&str> = msg
        .content
        .iter()
        .map(|c| match c {
            MessageContent::Leaf(LeafContent::Text { text, .. }) => text.as_str(),
            other => panic!("expected text content, got {other:?}"),
        })
        .collect();
    assert_eq!(texts, vec!["[Image: shot.png]", "hello"]);

    let metadata = msg
        .metadata
        .as_ref()
        .expect("queued message carries transient metadata");
    assert_eq!(metadata.get("queued"), Some(&serde_json::json!(true)));
    assert_eq!(
        metadata.get("attachments"),
        Some(&serde_json::json!([{ "id": "att-1" }]))
    );
    assert_eq!(
        metadata
            .get("uuid")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        sent_uuid
    );

    let context_updates = deps
        .events()
        .iter()
        .filter(|e| matches!(e, DaemonEvent::ContextUpdated { .. }))
        .count();
    assert_eq!(context_updates, 1);
}

#[tokio::test]
async fn mentions_in_plain_text_still_emit_context_updated() {
    let deps = FakeDeps::arc();
    *deps.workspace.mentions_found.lock().unwrap() = true;
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", false, true);
    seed_active(&mgr, "c1", working_chat("c1", Some("t"), false), session);

    mgr.send_message("c1", "look at @src/main.rs", None, None)
        .await
        .unwrap();

    let context_updates = deps
        .events()
        .iter()
        .filter(|e| matches!(e, DaemonEvent::ContextUpdated { .. }))
        .count();
    assert_eq!(context_updates, 1);
}

// ── Project removal and task termination ───────────────────────────────────────

#[tokio::test]
async fn calls_kill_tasks_before_session_kill_for_each_chat() {
    let mut c1 = test_chat("c1");
    c1.project_id = "p1".to_string();
    c1.worktree_path = Some("/wt/c1".to_string());
    let mut c2 = test_chat("c2");
    c2.project_id = "p1".to_string();
    c2.worktree_path = None;

    let deps = FakeDeps::with_chats(vec![c1.clone(), c2.clone()]);
    let order = deps.workspace.order.clone();
    let mgr = ChatManager::new(deps.clone());

    let s1 = RecSession::with_order("c1", order.clone());
    let s2 = RecSession::with_order("c2", order.clone());
    seed_active(&mgr, "c1", c1, s1);
    seed_active(&mgr, "c2", c2, s2);

    assert!(mgr.remove_project("p1").await.is_ok());

    let order = order.lock().unwrap();
    let idx = |s: &str| order.iter().position(|x| x == s);
    assert!(idx("kill:c1:/wt/c1").unwrap() < idx("sess.kill:c1").unwrap());
    assert!(idx("kill:c2:no-wt").unwrap() < idx("sess.kill:c2").unwrap());
    assert_eq!(
        deps.paths.project_removed.lock().unwrap().as_slice(),
        &["p1".to_string()]
    );
}

#[tokio::test]
async fn remove_project_propagates_a_row_delete_failure() {
    let mut c1 = test_chat("c1");
    c1.project_id = "p1".to_string();
    c1.worktree_path = Some("/wt/c1".to_string());

    let deps = FakeDeps::with_chats(vec![c1.clone()]);
    let order = deps.workspace.order.clone();
    *deps.paths.fail_project_remove.lock().unwrap() = Some("database is locked".to_string());
    let mgr = ChatManager::new(deps.clone());

    let s1 = RecSession::with_order("c1", order.clone());
    seed_active(&mgr, "c1", c1, s1);

    let err = mgr.remove_project("p1").await.unwrap_err();
    assert!(matches!(err, RemoveProjectError::Store(_)));
    assert_eq!(
        (err.status_kind(), err.to_string()),
        (StatusKind::Internal, "database is locked".to_string())
    );

    let order = order.lock().unwrap();
    let idx = |s: &str| order.iter().position(|x| x == s);
    assert!(idx("kill:c1:/wt/c1").unwrap() < idx("sess.kill:c1").unwrap());
    assert_eq!(
        deps.paths.project_removed.lock().unwrap().as_slice(),
        &["p1".to_string()]
    );
}

// ── discard_chat (rule 5) ─────────────────────────────────────────

#[tokio::test]
async fn discard_chat_stops_the_process_deletes_the_row_and_removes_the_scratch_dir() {
    let mut c1 = test_chat("c1");
    c1.temporary = true;
    c1.scratch_path = Some("/tmp/mf-scratch/c1".to_string());

    let deps = FakeDeps::with_chats(vec![c1.clone()]);
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", false, true);
    seed_active(&mgr, "c1", c1, session.clone());

    assert!(mgr.discard_chat("c1").await.is_ok());

    assert_eq!(
        session.kills.load(Ordering::SeqCst),
        1,
        "the process must be stopped"
    );
    assert!(
        mgr.get_active("c1").is_none(),
        "the active-chat entry must be dropped"
    );
    assert_eq!(
        deps.workspace
            .remove_scratch_dir_calls
            .lock()
            .unwrap()
            .as_slice(),
        &["/tmp/mf-scratch/c1".to_string()]
    );
    assert!(
        deps.chats_get("c1").unwrap().is_none(),
        "the row must be deleted (a subsequent GET 404s)"
    );
}

#[tokio::test]
async fn discard_chat_whose_scratch_dir_removal_fails_leaves_the_chat_discardable() {
    let mut c1 = test_chat("c1");
    c1.temporary = true;
    c1.scratch_path = Some("/tmp/mf-scratch/c1".to_string());

    let deps = FakeDeps::with_chats(vec![c1.clone()]);
    *deps.workspace.fail_remove_scratch_dir.lock().unwrap() = Some("permission denied".to_string());
    let mgr = ChatManager::new(deps.clone());

    let err = mgr.discard_chat("c1").await.unwrap_err();
    assert_eq!(
        (err.status_kind(), err.to_string()),
        (StatusKind::Internal, "permission denied".to_string())
    );
    assert!(
        deps.chats_get("c1").unwrap().is_some(),
        "a failed removal must leave the row (and a retry) intact"
    );

    // Retry, this time the removal succeeds.
    *deps.workspace.fail_remove_scratch_dir.lock().unwrap() = None;
    assert!(mgr.discard_chat("c1").await.is_ok());
    assert!(deps.chats_get("c1").unwrap().is_none());
}

#[tokio::test]
async fn discard_chat_404s_for_an_unknown_chat() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps);
    let err = mgr.discard_chat("missing").await.unwrap_err();
    assert_eq!(
        (err.status_kind(), err.to_string()),
        (StatusKind::NotFound, "Chat not found".to_string())
    );
}

// ── facade methods ──────────────────────────────────────────────────

use mainframe_types::adapter::EffortLevel;
use mainframe_types::context::{MentionKind, MentionSource, SessionMention};
