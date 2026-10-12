use super::*;

#[tokio::test]
async fn failed_command_state_write_does_not_fail_a_delivered_command() {
    let (mgr, deps, session) = title_cmd_manager(Some("named"));
    *deps.store.write_failure.lock().unwrap() = Some("write failed".into());
    mgr.send_message(
        "chat-1",
        "/compact",
        None,
        Some(CommandMeta {
            name: "compact".into(),
            source: "claude".into(),
            args: None,
        }),
    )
    .await
    .unwrap();
    assert_eq!(session.send_command_calls.lock().unwrap().len(), 1);
    assert_eq!(
        mgr.get_chat("chat-1").unwrap().process_state,
        Some(Some(ProcessState::Working))
    );
    assert_storage_events(&deps.events(), &["error", "chat.updated"]);
    mgr.dispose();
}

#[tokio::test]
async fn failed_turn_writes_do_not_skip_delivery() {
    let (mgr, deps, session) = title_cmd_manager(Some("named"));
    *deps.store.write_failure.lock().unwrap() = Some("write failed".into());
    mgr.send_message("chat-1", "hello", None, None)
        .await
        .unwrap();
    assert_eq!(session.send_message_calls.lock().unwrap().len(), 1);
    assert_eq!(
        mgr.get_chat("chat-1").unwrap().process_state,
        Some(Some(ProcessState::Working))
    );
    assert_storage_events(&deps.events(), &["error", "chat.updated"]);
    mgr.dispose();
}

#[tokio::test]
async fn failed_steer_mentions_do_not_fail_delivered_steer() {
    let (mgr, deps, session) = title_cmd_manager(Some("named"));
    *deps.store.write_failure.lock().unwrap() = Some("write failed".into());
    let cell = mgr.get_active("chat-1").unwrap();
    let live: Arc<dyn AdapterSession> = session.clone();
    mgr.send_plain_text(&cell, &live, "chat-1", "hello", None, Delivery::Steer)
        .await
        .unwrap();
    assert_eq!(session.steer_calls.lock().unwrap().as_slice(), &["hello"]);
    assert_storage_events(&deps.events(), &["error"]);
    mgr.dispose();
}

#[tokio::test]
async fn failed_archive_list_and_write_still_tears_down_and_emits_ended() {
    let (mgr, deps, session) = title_cmd_manager(Some("named"));
    *deps.store.write_failure.lock().unwrap() = Some("write failed".into());
    *deps.store.list_failure.lock().unwrap() = Some("list failed".into());
    *deps.workspace.has_launches.lock().unwrap() = true;
    mgr.archive_chat("chat-1", false).await;
    assert_eq!(session.kills.load(Ordering::SeqCst), 1);
    assert!(!deps.workspace.stop_calls.lock().unwrap().is_empty());
    assert!(mgr.get_active("chat-1").is_none());
    assert!(
        deps.events()
            .iter()
            .any(|e| matches!(e, DaemonEvent::ChatEnded { chat_id } if chat_id == "chat-1"))
    );
    assert_storage_events(
        &deps.events(),
        &["error", "launch.scopeReleased", "chat.ended"],
    );
    mgr.dispose();
}

#[tokio::test]
async fn failed_end_write_still_emits_ended() {
    let (mgr, deps, session) = title_cmd_manager(Some("named"));
    *deps.store.write_failure.lock().unwrap() = Some("write failed".into());
    mgr.end_chat("chat-1").await;
    assert_eq!(session.kills.load(Ordering::SeqCst), 1);
    assert!(mgr.get_active("chat-1").is_none());
    assert!(
        deps.events()
            .iter()
            .any(|e| matches!(e, DaemonEvent::ChatEnded { .. }))
    );
    assert_storage_events(&deps.events(), &["error", "chat.ended"]);
    mgr.dispose();
}

fn assert_storage_events(events: &[DaemonEvent], expected: &[&str]) {
    let tags: Vec<String> = events
        .iter()
        .map(|e| {
            serde_json::to_value(e).unwrap()["type"]
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
    assert_eq!(tags, expected);
    assert!(events.iter().any(|e| matches!(e, DaemonEvent::Error { chat_id: Some(id), error } if id == "chat-1" && error == "Chat storage operation failed")));
}
