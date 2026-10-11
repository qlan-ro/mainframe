use super::*;

#[tokio::test]
async fn repoints_the_stored_session_file_path_at_the_new_worktree() {
    let session = Arc::new(FakeSession::spawned());
    let cell = cell_with_chat(claude_worktreed_chat(), session);
    let deps = Setup::with_project(cell.clone(), test_project());
    let manager = Harness::new(deps);

    manager
        .attach_worktree("c1", "/new/wt", Some("feat"))
        .await
        .unwrap();

    let expected = dirs::home_dir()
        .unwrap()
        .join(".claude/projects/-new-wt/sess1.jsonl")
        .to_string_lossy()
        .to_string();
    assert_eq!(
        manager.updates().as_slice(),
        &[ChatPatch {
            worktree_path: Some(Some("/new/wt".to_string())),
            branch_name: Some(Some("feat".to_string())),
            session_file_path: Some(expected.clone()),
            ..Default::default()
        }]
    );
    assert_eq!(
        cell.lock().unwrap().chat.session_file_path,
        Some(expected),
        "the broadcast chat must carry the new path, not the emptied directory"
    );
}

#[tokio::test]
async fn restarts_the_chat_when_moving_session_files_fails() {
    let session = Arc::new(FakeSession::spawned());
    let cell = cell_with_chat(claude_worktreed_chat(), session);
    let deps = Setup::failing_move(
        cell.clone(),
        test_project(),
        "No such file or directory (os error 2)",
    );
    let manager = Harness::new(deps);

    let err = manager
        .attach_worktree("c1", "/new/wt", Some("feat"))
        .await
        .unwrap_err();

    assert_eq!(
        err.to_string(),
        "Moving the session's history into the worktree failed. The chat kept its previous binding; some history files may have moved.",
        "raw io text must not reach the user-facing toast"
    );
    assert_eq!(
        manager.starts(),
        1,
        "expected the stopped chat to be restarted rather than stranded"
    );
}

#[tokio::test]
async fn keeps_the_old_binding_when_moving_session_files_fails() {
    let session = Arc::new(FakeSession::spawned());
    let cell = cell_with_chat(claude_worktreed_chat(), session);
    let deps = Setup::failing_move(cell.clone(), test_project(), "boom");
    let manager = Harness::new(deps);

    manager
        .attach_worktree("c1", "/new/wt", Some("feat"))
        .await
        .unwrap_err();

    assert!(manager.updates().is_empty());
    assert!(manager.bindings().is_empty());
    let chat = cell.lock().unwrap().chat.clone();
    assert_eq!(chat.worktree_path.as_deref(), Some("/old/wt"));
    assert_eq!(chat.branch_name.as_deref(), Some("old-branch"));
}

#[test]
fn effective_dir_is_the_worktree_when_bound_else_the_project_path() {
    assert_eq!(effective_dir(Some("/wt"), "/proj"), "/wt");
    assert_eq!(effective_dir(None, "/proj"), "/proj");
}

#[tokio::test]
async fn attaching_without_a_branch_name_persists_a_cleared_branch() {
    let session = Arc::new(FakeSession::spawned());
    let cell = cell_with(session);
    let deps = Setup::with_project(cell.clone(), test_project());
    let manager = Harness::new(deps);

    manager
        .attach_worktree("c1", "/new/wt", None)
        .await
        .unwrap();

    let updates = manager.updates();
    assert_eq!(
        updates.as_slice(),
        &[ChatPatch {
            worktree_path: Some(Some("/new/wt".to_string())),
            branch_name: Some(None),
            ..Default::default()
        }]
    );
}

#[tokio::test]
async fn attach_worktree_fires_on_binding_changed_exactly_once_with_the_new_path() {
    let session = Arc::new(FakeSession::spawned());
    let cell = cell_with(session);
    let deps = Setup::with_project(cell.clone(), test_project());
    let manager = Harness::new(deps);

    manager
        .attach_worktree("c1", "/new/wt", Some("feat"))
        .await
        .unwrap();

    let binding_changed = manager.bindings();
    assert_eq!(binding_changed.as_slice(), &[Some("/new/wt".to_string())]);
}

#[tokio::test]
async fn enabling_a_worktree_restarts_the_chat_when_moving_session_files_fails() {
    let (repo, project) = git_project();
    let session = Arc::new(FakeSession::spawned());
    let cell = cell_with_chat(claude_live_chat(), session.clone());
    let deps = Setup::failing_move(cell.clone(), project, "boom");
    let manager = Harness::new(deps);

    let err = manager
        .enable_worktree("c1", "HEAD", "feat/x")
        .await
        .unwrap_err();

    assert_eq!(
        err.to_string(),
        format!(
            "The worktree was created at {}, but moving the session's history failed. The chat kept its previous binding; some history files may have moved.",
            repo.path().join(".worktrees/feat-x").display()
        )
    );
    assert_created_worktree(&repo);
    assert_eq!(session.kills(), 1);
    assert_eq!(
        manager.starts(),
        1,
        "the stopped chat must be running again, not stranded"
    );
    assert!(manager.updates().is_empty());
    assert!(manager.bindings().is_empty());
    let chat = cell.lock().unwrap().chat.clone();
    assert_eq!(chat.worktree_path, None);
    assert_eq!(chat.branch_name, None);
}

#[tokio::test]
async fn enabling_a_worktree_on_a_live_chat_binds_it_and_restarts_it() {
    let (repo, project) = git_project();
    let session = Arc::new(FakeSession::spawned());
    let cell = cell_with_chat(claude_live_chat(), session.clone());
    let deps = Setup::with_project(cell.clone(), project);
    let manager = Harness::new(deps);

    manager
        .enable_worktree("c1", "HEAD", "feat/x")
        .await
        .unwrap();

    let worktree = repo
        .path()
        .join(".worktrees/feat-x")
        .to_string_lossy()
        .to_string();
    let updates = manager.updates().clone();
    let [update] = updates.as_slice() else {
        panic!("expected exactly one persisted update, got {updates:?}");
    };
    assert_eq!(update.worktree_path, Some(Some(worktree.clone())));
    assert_eq!(update.branch_name, Some(Some("feat/x".to_string())));
    let transcript = update.session_file_path.clone().unwrap();
    let projects_dir = dirs::home_dir().unwrap().join(".claude/projects");
    assert!(
        transcript.starts_with(&*projects_dir.to_string_lossy())
            && transcript.ends_with("--worktrees-feat-x/sess1.jsonl"),
        "the stored transcript must point into the worktree's project dir, got {transcript}"
    );
    assert_eq!(session.kills(), 1);
    assert_eq!(manager.starts(), 1);
    assert!(
        manager.deps.workspace.stop_calls.lock().unwrap().is_empty(),
        "an unbound chat has no worktree launch processes to stop"
    );
    assert_eq!(manager.bindings().as_slice(), &[Some(worktree)]);
}

#[tokio::test]
async fn pre_session_move_failure_reports_the_created_worktree_and_keeps_binding() {
    let (repo, project) = git_project();
    let cell = Arc::new(Mutex::new(ActiveChat::new(test_chat("c1"), None)));
    let mut deps = Setup::failing_move(cell.clone(), project, "disk full");
    deps.owned.push(OwnedNativeSession {
        native_ref: "native-1".into(),
        adapter_id: "claude".into(),
        session_id: "session-1".into(),
    });
    let manager = Harness::new(deps);
    let error = manager
        .enable_worktree("c1", "HEAD", "feat/x")
        .await
        .unwrap_err();
    assert!(matches!(error, ConfigError::WorktreeCreated { .. }));
    assert_eq!(
        error.to_string(),
        format!(
            "The worktree was created at {}, but moving the session's history failed. The chat kept its previous binding; some history files may have moved.",
            repo.path().join(".worktrees/feat-x").display()
        )
    );
    assert_created_worktree(&repo);
    assert!(manager.updates().is_empty());
    assert!(manager.bindings().is_empty());
    assert_eq!(cell.lock().unwrap().chat.worktree_path, None);
}
