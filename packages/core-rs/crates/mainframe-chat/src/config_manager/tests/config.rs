use super::*;

#[tokio::test]
async fn persists_permission_mode_even_when_set_model_rejects() {
    let session = Arc::new(FakeSession {
        set_model_ok: false,
        set_permission_mode_ok: true,
        ..FakeSession::spawned()
    });
    let cell = cell_with(session.clone());
    let deps = Setup::new(cell.clone());
    let manager = Harness::new(deps);

    manager
        .update_chat_config(
            "c1",
            None,
            Some("new-model".to_string()),
            Some(ExecutionMode::AcceptEdits),
            None,
        )
        .await
        .unwrap_err();

    assert_eq!(
        session.set_model_calls.lock().unwrap().as_slice(),
        &["new-model".to_string()]
    );
    assert_eq!(
        session.set_permission_mode_calls.lock().unwrap().as_slice(),
        &[ExecutionMode::AcceptEdits]
    );
    let updates = manager.updates();
    assert_eq!(
        updates.as_slice(),
        &[ChatPatch {
            permission_mode: Some(ExecutionMode::AcceptEdits),
            ..Default::default()
        }]
    );
    let chat = cell.lock().unwrap().chat.clone();
    assert_eq!(chat.model.as_deref(), Some("old-model")); // rejected — not applied
    assert_eq!(chat.permission_mode, Some(ExecutionMode::AcceptEdits)); // succeeded — applied
    let events = manager.deps.events();
    assert_eq!(events.len(), 1);
    assert!(
        matches!(&events[0], DaemonEvent::ChatUpdated { chat: c, reason: None } if c.permission_mode == Some(ExecutionMode::AcceptEdits))
    );
}

#[tokio::test]
async fn moving_a_live_chat_onto_an_endpoint_model_respawns_instead_of_setting_the_model() {
    let session = Arc::new(FakeSession::spawned());
    let cell = cell_with(session.clone());
    let manager = Harness::new(Setup::new(cell.clone()));

    manager
        .update_chat_config(
            "c1",
            None,
            Some("cliproxy/gpt-5.6-sol".to_string()),
            None,
            None,
        )
        .await
        .unwrap();

    assert!(session.set_model_calls.lock().unwrap().is_empty());
    assert_eq!(session.kills(), 1);
    assert_eq!(manager.starts(), 1);
    assert_eq!(
        cell.lock().unwrap().chat.model.as_deref(),
        Some("cliproxy/gpt-5.6-sol")
    );
}

#[tokio::test]
async fn switching_between_two_models_on_the_same_endpoint_stays_live() {
    let session = Arc::new(FakeSession::spawned());
    let cell = cell_with(session.clone());
    cell.lock().unwrap().chat.model = Some("cliproxy/gpt-5.6-sol".to_string());
    let manager = Harness::new(Setup::new(cell.clone()));

    manager
        .update_chat_config("c1", None, Some("cliproxy/kimi-k3".to_string()), None, None)
        .await
        .unwrap();

    assert_eq!(
        session.set_model_calls.lock().unwrap().as_slice(),
        &["cliproxy/kimi-k3".to_string()]
    );
    assert_eq!(session.kills(), 0);
    assert_eq!(manager.starts(), 0);
}

#[tokio::test]
async fn inherited_runtime_endpoint_requires_restart_when_selecting_native_model() {
    let session = Arc::new(FakeSession {
        model_requires_restart: true,
        ..FakeSession::spawned()
    });
    let cell = cell_with(session.clone());
    cell.lock().unwrap().chat.model = None;
    let manager = Harness::new(Setup::new(cell.clone()));

    manager
        .update_chat_config("c1", None, Some("claude-opus-5-5".into()), None, None)
        .await
        .unwrap();

    assert_eq!(session.kills(), 1);
    assert_eq!(manager.starts(), 1);
    assert!(session.set_model_calls.lock().unwrap().is_empty());
    assert_eq!(
        cell.lock().unwrap().chat.model.as_deref(),
        Some("claude-opus-5-5")
    );
    assert_eq!(
        manager.updates().as_slice(),
        &[ChatPatch {
            model: Some("claude-opus-5-5".into()),
            ..Default::default()
        }]
    );
}

#[tokio::test]
async fn later_explicit_selection_wins_over_a_slow_inheritance_resolution() {
    let gate = Arc::new((tokio::sync::Notify::new(), tokio::sync::Notify::new()));
    let session = Arc::new(FakeSession {
        model_gate: Some(gate.clone()),
        ..FakeSession::spawned()
    });
    let cell = cell_with(session);
    let manager = Arc::new(Harness::new(Setup::new(cell.clone())));
    let first_manager = manager.clone();
    let first = tokio::spawn(async move {
        first_manager
            .update_chat_config("c1", None, Some("default".into()), None, None)
            .await
    });
    gate.0.notified().await;
    let mut later = Box::pin(manager.update_chat_config(
        "c1",
        None,
        Some("claude-opus-5-5".into()),
        None,
        None,
    ));
    let polled = std::future::poll_fn(|cx| {
        std::task::Poll::Ready(std::future::Future::poll(later.as_mut(), cx))
    })
    .await;
    gate.1.notify_one();
    first.await.unwrap().unwrap();
    match polled {
        std::task::Poll::Ready(result) => result,
        std::task::Poll::Pending => later.await,
    }
    .unwrap();

    assert_eq!(
        cell.lock().unwrap().chat.model.as_deref(),
        Some("claude-opus-5-5")
    );
    let updates = manager.updates();
    assert_eq!(
        updates.last().unwrap().model.as_deref(),
        Some("claude-opus-5-5")
    );
}

#[tokio::test]
async fn does_not_persist_or_emit_when_every_setting_rejects() {
    let session = Arc::new(FakeSession {
        set_model_ok: false,
        ..FakeSession::spawned()
    });
    let cell = cell_with(session);
    let deps = Setup::new(cell);
    let manager = Harness::new(deps);

    manager
        .update_chat_config("c1", None, Some("new-model".to_string()), None, None)
        .await
        .unwrap_err();

    assert!(manager.updates().is_empty());
    assert!(manager.deps.events().is_empty());
}

#[tokio::test]
async fn rebinds_a_worktreed_chat_to_a_different_worktree() {
    let session = Arc::new(FakeSession::spawned());
    let cell = cell_with_chat(worktreed_chat(), session.clone());
    let deps = Setup::with_project(cell.clone(), test_project());
    let manager = Harness::new(deps);

    manager
        .attach_worktree("c1", "/new/wt", Some("feat"))
        .await
        .unwrap();

    let updates = manager.updates();
    assert_eq!(
        updates.as_slice(),
        &[ChatPatch {
            worktree_path: Some(Some("/new/wt".to_string())),
            branch_name: Some(Some("feat".to_string())),
            ..Default::default()
        }]
    );
    assert_eq!(
        manager.starts(),
        1,
        "expected start_chat to be called once to restart the chat in the new worktree"
    );
}

#[tokio::test]
async fn attaching_the_same_worktree_path_is_a_no_op() {
    let session = Arc::new(FakeSession::spawned());
    let cell = cell_with_chat(worktreed_chat(), session.clone());
    let deps = Setup::with_project(cell.clone(), test_project());
    let manager = Harness::new(deps);

    manager
        .attach_worktree("c1", "/old/wt", Some("old-branch"))
        .await
        .unwrap();

    assert_eq!(session.kills(), 0);
    assert!(manager.updates().is_empty());
    assert!(manager.deps.events().is_empty());
}

#[tokio::test]
async fn rebinding_stops_launch_processes_for_the_old_worktree_path() {
    let session = Arc::new(FakeSession::spawned());
    let cell = cell_with_chat(worktreed_chat(), session.clone());
    let deps = Setup::with_project(cell.clone(), test_project());
    let manager = Harness::new(deps);

    manager
        .attach_worktree("c1", "/new/wt", Some("feat"))
        .await
        .unwrap();

    let stop_launch_calls = manager.deps.workspace.stop_calls.lock().unwrap();
    assert_eq!(
        stop_launch_calls.as_slice(),
        &[("p1".to_string(), "/old/wt".to_string())]
    );
}
