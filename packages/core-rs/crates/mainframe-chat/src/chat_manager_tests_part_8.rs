// ── external_session_service() facade wiring ────────────────────────────────

fn external_session(id: &str) -> mainframe_types::adapter::ExternalSession {
    mainframe_types::adapter::ExternalSession {
        session_id: id.to_string(),
        adapter_id: "claude".to_string(),
        project_path: "/tmp/p".to_string(),
        cwd: None,
        first_prompt: None,
        title: None,
        summary: None,
        message_count: None,
        created_at: "now".to_string(),
        modified_at: "now".to_string(),
        git_branch: None,
        model: None,
    }
}

#[tokio::test]
async fn external_session_service_is_none_until_injected() {
    let mgr = ChatManager::new(FakeDeps::arc());
    assert!(mgr.external_session_service().is_none());
}

#[tokio::test]
async fn with_external_sessions_wires_scan_page_through_the_facade() {
    let ext = Arc::new(FakeDeps::default());
    ext.set_project_path("/tmp/p");
    ext.external_sessions
        .lock()
        .unwrap()
        .push(external_session("s1"));
    let mgr = ChatManager::new(ext.clone()).with_external_sessions(ext.clone());

    let facade = mgr.external_session_service().expect("service injected");
    let page = facade.scan_page("p1", 0, 50).await.unwrap();

    assert_eq!(page.total, 1);
    assert_eq!(page.sessions[0].session_id, "s1");
}

#[tokio::test]
async fn with_external_sessions_wires_import_session_through_the_facade() {
    let ext = Arc::new(FakeDeps::default());
    let mgr = ChatManager::new(ext.clone()).with_external_sessions(ext.clone());

    let facade = mgr.external_session_service().expect("service injected");
    let chat = facade
        .import_session("p1", "s1", "claude", None, None, None)
        .await
        .unwrap();

    assert_eq!(chat.project_id, "p1");
    assert_eq!(chat.adapter_id, "claude");
    assert_eq!(
        ext.store
            .created
            .lock()
            .unwrap()
            .iter()
            .map(|c| (c.project_id.clone(), c.adapter_id.clone()))
            .collect::<Vec<_>>(),
        [("p1".to_string(), "claude".to_string())]
    );
}

#[tokio::test]
async fn import_session_title_drops_the_session_reference_preamble() {
    let ext = Arc::new(FakeDeps::default());
    let mgr = ChatManager::new(ext.clone()).with_external_sessions(ext.clone());

    let facade = mgr.external_session_service().expect("service injected");
    let chat = facade
        .import_session(
            "p1",
            "s1",
            "claude",
            Some("Referenced session @session[Model Identity]: /repo/a.jsonl\n\nlook at this"),
            None,
            None,
        )
        .await
        .unwrap();

    assert_eq!(chat.title.as_deref(), Some("look at this"));
}

// ── trust_workspace ─────────────────────────────────────────────────────────

#[tokio::test]
async fn trust_workspace_persists_the_project_root_when_the_chat_has_no_worktree() {
    let deps = FakeDeps::with_chats(vec![test_chat("c1")]);
    let mgr = ChatManager::new(deps.clone());

    mgr.trust_workspace("c1").await.unwrap();

    assert_eq!(
        *deps.workspace.trusted_paths.lock().unwrap(),
        vec!["/tmp/test"]
    );
}

#[tokio::test]
async fn trust_workspace_prefers_the_chat_worktree_path_over_the_project_root() {
    let mut chat = test_chat("c1");
    chat.worktree_path = Some("/home/me/proj-wt".to_string());
    let deps = FakeDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps.clone());

    mgr.trust_workspace("c1").await.unwrap();

    assert_eq!(
        *deps.workspace.trusted_paths.lock().unwrap(),
        vec!["/home/me/proj-wt"]
    );
}

#[tokio::test]
async fn trust_workspace_errors_when_the_chat_is_missing() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());

    let err = mgr.trust_workspace("missing").await.unwrap_err();

    assert!(matches!(err, TrustWorkspaceError::ChatNotFound(id) if id == "missing"));
    assert!(deps.workspace.trusted_paths.lock().unwrap().is_empty());
}

#[tokio::test]
async fn trust_workspace_propagates_a_write_failure_without_gating_being_bypassed() {
    let deps = FakeDeps::with_chats(vec![test_chat("c1")]);
    *deps.workspace.fail_trust_write.lock().unwrap() = Some("disk full".to_string());
    let mgr = ChatManager::new(deps.clone());

    let err = mgr.trust_workspace("c1").await.unwrap_err();

    assert!(matches!(err, TrustWorkspaceError::Write(_)));
    assert_eq!(
        (err.status_kind(), err.to_string()),
        (StatusKind::Internal, "disk full".to_string())
    );
}

// ── accept_worktree_offer gating ────────────────────────────────────────────

#[tokio::test]
async fn accept_worktree_offer_refuses_while_a_turn_is_in_flight() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        RecSession::new("c1", true, true),
    );

    let err = mgr
        .accept_worktree_offer("c1", "/tmp/wt")
        .await
        .unwrap_err();

    assert!(matches!(err, OfferError::ChatBusy));
    assert_eq!(err.status_kind(), StatusKind::Conflict);
}

/// Idle reaches the registry instead — `NotPending` proves the busy gate let it
/// through, since nothing was ever offered here.
#[tokio::test]
async fn accept_worktree_offer_reaches_the_registry_when_the_chat_is_idle() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), false),
        RecSession::new("c1", true, true),
    );

    let err = mgr
        .accept_worktree_offer("c1", "/tmp/wt")
        .await
        .unwrap_err();

    assert!(matches!(err, OfferError::NotPending));
}

// ── composer-driven rebinds (enable / attach / disable) ─────────────────────

/// The composer's worktree control reaches the config manager directly, not
/// through an offer, so each of its three rebinds needs the same busy gate.
async fn working_manager(working: bool) -> ChatManager {
    let mgr = ChatManager::new(FakeDeps::arc());
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), working),
        RecSession::new("c1", true, true),
    );
    mgr
}

#[tokio::test]
async fn enable_worktree_refuses_while_a_turn_is_in_flight() {
    let mgr = working_manager(true).await;

    let err = mgr
        .enable_worktree("c1", "main", "feat/x")
        .await
        .unwrap_err();

    assert!(matches!(err, ConfigError::ChatBusy));
}

#[tokio::test]
async fn attach_worktree_refuses_while_a_turn_is_in_flight() {
    let mgr = working_manager(true).await;

    let err = mgr
        .attach_worktree("c1", "/tmp/wt", Some("feat/x"))
        .await
        .unwrap_err();

    assert!(matches!(err, ConfigError::ChatBusy));
}

#[tokio::test]
async fn disable_worktree_refuses_while_a_turn_is_in_flight() {
    let mgr = working_manager(true).await;

    let err = mgr.disable_worktree("c1").await.unwrap_err();

    assert!(matches!(err, ConfigError::ChatBusy));
}

#[tokio::test]
async fn attach_worktree_rebinds_when_the_chat_is_idle() {
    let mgr = working_manager(false).await;

    mgr.attach_worktree("c1", "/tmp/wt", Some("feat/x"))
        .await
        .unwrap();

    let chat = mgr.get_chat("c1").expect("chat");
    assert_eq!(chat.worktree_path.as_deref(), Some("/tmp/wt"));
    assert_eq!(chat.branch_name.as_deref(), Some("feat/x"));
}

#[path = "chat_manager_tests_storage_failures.rs"]
mod storage_failures;

#[path = "chat_manager_tests_flow_golden.rs"]
mod flow_golden;
