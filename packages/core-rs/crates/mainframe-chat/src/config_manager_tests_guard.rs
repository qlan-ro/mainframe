use super::*;

#[tokio::test]
async fn checked_config_reads_current_state_after_acquiring_the_write_lock() {
    let cell = cell_with(Arc::new(FakeSession::spawned()));
    cell.lock().unwrap().chat.adapter_id = "codex".into();
    let manager = Arc::new(Harness::new(Setup::new(cell.clone())));
    let lock = manager.lock_changes("c1").await;
    let task_manager = manager.clone();
    let task = tokio::spawn(async move {
        task_manager
            .update_checked(
                "c1",
                ConfigUpdate {
                    permission_mode: Some(ExecutionMode::Auto),
                    ..Default::default()
                },
                &|chat| {
                    if chat.adapter_id == "codex" {
                        Ok(())
                    } else {
                        Err(ConfigError::Refused("Provider changed".into()))
                    }
                },
            )
            .await
    });
    tokio::task::yield_now().await;
    assert!(!task.is_finished());
    cell.lock().unwrap().chat.adapter_id = "claude".into();
    drop(lock);
    assert!(matches!(task.await.unwrap(), Err(ConfigError::Refused(_))));
    assert!(manager.updates().is_empty());
    assert_ne!(
        cell.lock().unwrap().chat.permission_mode,
        Some(ExecutionMode::Auto)
    );
}

#[tokio::test]
async fn checked_config_refuses_registered_sends_and_running_turns() {
    let cell = cell_with(Arc::new(FakeSession::spawned()));
    let manager = Harness::new(Setup::new(cell.clone()));
    let send = manager.lifecycle.begin_send("c1").await;
    let changes = || ConfigUpdate {
        model: Some("new".into()),
        ..Default::default()
    };
    let result = manager.update_checked("c1", changes(), &|_| Ok(())).await;
    assert!(matches!(result, Err(ConfigError::ChatBusy)));
    drop(send);
    cell.lock().unwrap().chat.process_state =
        Some(Some(mainframe_types::chat::ProcessState::Working));
    let result = manager.update_checked("c1", changes(), &|_| Ok(())).await;
    assert!(matches!(result, Err(ConfigError::ChatBusy)));
    assert!(manager.updates().is_empty());
}

#[tokio::test]
async fn checked_config_defers_respawn_and_releases_sends() {
    let session = Arc::new(FakeSession::spawned());
    let cell = cell_with(session.clone());
    let manager = Harness::new(Setup::new(cell.clone()));
    let changes = ConfigUpdate {
        model: Some("cliproxy/gpt-5.6-sol".into()),
        ..Default::default()
    };
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        manager.update_checked("c1", changes, &|_| Ok(())),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        cell.lock().unwrap().chat.model.as_deref(),
        Some("cliproxy/gpt-5.6-sol")
    );
    assert_eq!(manager.starts(), 0);
    assert_eq!(session.kills(), 1);
    let _send = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        manager.lifecycle.begin_send("c1"),
    )
    .await
    .unwrap();
}
