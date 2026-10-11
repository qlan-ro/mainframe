use super::*;

#[tokio::test]
async fn failed_rebind_write_restarts_on_the_previous_binding() {
    let cell = cell_with(Arc::new(FakeSession::spawned()));
    let manager = Harness::new(Setup::new(cell.clone()));
    manager.deps.set_history(Vec::new());
    *manager.deps.store.write_failure.lock().unwrap() = Some("private sqlite error".into());
    let result = manager
        .rebind_live_session(
            &cell,
            "c1",
            LiveRebind {
                project_id: "p1",
                old_dir: "/tmp",
                old_worktree: None,
                active: ActiveSession {
                    adapter_id: "codex",
                    session_id: None,
                },
                worktree_path: "/tmp/new-worktree".into(),
                branch_name: Some("new".into()),
            },
        )
        .await;
    assert!(matches!(result, Err(ConfigError::Store(_))));
    let guard = cell.lock().unwrap();
    assert_eq!(guard.chat.worktree_path, None);
    assert!(
        guard.session.as_ref().is_some_and(|s| s.is_spawned()),
        "{:?}",
        manager.deps.events()
    );
    assert_eq!(manager.starts(), 1);
}

#[tokio::test]
async fn failed_respawn_write_restarts_with_the_previous_config() {
    let cell = cell_with(Arc::new(FakeSession::spawned()));
    let old_model = cell.lock().unwrap().chat.model.clone();
    let manager = Harness::new(Setup::new(cell.clone()));
    manager.deps.set_history(Vec::new());
    *manager.deps.store.write_failure.lock().unwrap() = Some("private sqlite error".into());
    let result = manager
        .respawn_with_config(
            "c1",
            &cell,
            RespawnChanges {
                adapter_id: None,
                model: Some("changed".into()),
                permission_mode: None,
                plan_mode: None,
            },
        )
        .await;
    assert_eq!(result.unwrap_err().to_string(), "Internal server error");
    let guard = cell.lock().unwrap();
    assert_eq!(guard.chat.model, old_model);
    assert!(
        guard.session.as_ref().is_some_and(|s| s.is_spawned()),
        "{:?}",
        manager.deps.events()
    );
}

#[tokio::test]
async fn failed_live_enable_write_reports_created_path_and_keeps_session_running() {
    let (repo, project) = git_project();
    let cell = cell_with_chat(claude_live_chat(), Arc::new(FakeSession::spawned()));
    let manager = Harness::new(Setup::with_project(cell.clone(), project));
    manager.deps.set_history(Vec::new());
    *manager.deps.store.write_failure.lock().unwrap() = Some("private sqlite error".into());
    let error = manager
        .enable_worktree("c1", "HEAD", "feat/x")
        .await
        .unwrap_err();
    assert!(
        matches!(&error, ConfigError::WorktreeCreated { worktree_path, .. }
        if worktree_path == repo.path().join(".worktrees/feat-x").to_str().unwrap())
    );
    assert!(!error.to_string().contains("private sqlite"));
    assert_created_worktree(&repo);
    assert_eq!(
        cell.lock().unwrap().chat.worktree_path.as_deref(),
        repo.path().join(".worktrees/feat-x").to_str()
    );
    assert!(
        cell.lock()
            .unwrap()
            .session
            .as_ref()
            .is_some_and(|s| s.is_spawned())
    );
}

#[tokio::test]
async fn failed_claude_rebind_write_keeps_binding_with_moved_transcript() {
    let cell = cell_with_chat(claude_live_chat(), Arc::new(FakeSession::spawned()));
    let manager = Harness::new(Setup::new(cell.clone()));
    manager.deps.set_history(Vec::new());
    *manager.deps.store.write_failure.lock().unwrap() = Some("write failed".into());
    let result = manager
        .rebind_live_session(
            &cell,
            "c1",
            LiveRebind {
                project_id: "p1",
                old_dir: "/tmp",
                old_worktree: None,
                active: ActiveSession {
                    adapter_id: "claude",
                    session_id: Some("sess1"),
                },
                worktree_path: "/tmp/new-worktree".into(),
                branch_name: Some("new".into()),
            },
        )
        .await;
    assert!(matches!(result, Err(ConfigError::Store(_))));
    let guard = cell.lock().unwrap();
    assert_eq!(
        guard.chat.worktree_path.as_deref(),
        Some("/tmp/new-worktree")
    );
    assert_eq!(
        guard.chat.session_file_path,
        Some(crate::event_handler::compute_session_file_path(
            "/tmp/new-worktree",
            "sess1"
        ))
    );
    assert_eq!(
        *manager.deps.workspace.move_destinations.lock().unwrap(),
        vec![
            mainframe_services::workspace::get_claude_project_dir("/tmp/new-worktree")
                .to_string_lossy()
                .into_owned()
        ]
    );
    assert!(guard.session.as_ref().is_some_and(|s| s.is_spawned()));
}

#[tokio::test]
async fn failed_live_settings_write_emits_the_accepted_config() {
    use mainframe_types::events::DaemonEvent;
    let session = Arc::new(FakeSession::spawned());
    let cell = cell_with(session.clone());
    let manager = Harness::new(Setup::new(cell.clone()));
    *manager.deps.store.write_failure.lock().unwrap() = Some("write failed".into());
    manager
        .apply_live_session_settings(
            "c1",
            &cell,
            &(session as Arc<dyn AdapterSession>),
            LiveChanges {
                model: None,
                permission_mode: None,
                plan_mode: Some(true),
            },
        )
        .await
        .unwrap();
    assert_eq!(cell.lock().unwrap().chat.plan_mode, Some(true));
    assert!(matches!(manager.deps.events().as_slice(), [
        DaemonEvent::Error { chat_id: Some(id), .. },
        DaemonEvent::ChatUpdated { chat, reason: None }
    ] if id == "c1" && chat.plan_mode == Some(true)));
}
