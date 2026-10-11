#[tokio::test]
async fn leaves_an_already_idle_chat_unchanged() {
    let deps = FakeDeps::with_chats(vec![
        stored("c-working", Some(Some(ProcessState::Working))),
        stored("c-idle", Some(Some(ProcessState::Idle))),
    ]);
    let mgr = ChatManager::new(deps.clone());
    mgr.recover_stale_working_state();
    assert_eq!(
        deps.chats_get("c-idle").unwrap().unwrap().process_state,
        Some(Some(ProcessState::Idle))
    );
}

#[tokio::test]
async fn does_not_touch_a_chat_whose_process_state_is_null() {
    let deps = FakeDeps::with_chats(vec![stored("c-null", Some(None))]);
    let mgr = ChatManager::new(deps.clone());
    mgr.recover_stale_working_state();
    assert_eq!(
        deps.chats_get("c-null").unwrap().unwrap().process_state,
        Some(None)
    );
}

#[tokio::test]
async fn is_a_no_op_when_no_chats_are_stored() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps);
    mgr.recover_stale_working_state(); // must not panic
}

#[tokio::test]
async fn resets_every_working_chat_when_multiple_are_stale() {
    let deps = FakeDeps::with_chats(vec![
        stored("w1", Some(Some(ProcessState::Working))),
        stored("w2", Some(Some(ProcessState::Working))),
        stored("ok", Some(Some(ProcessState::Idle))),
    ]);
    let mgr = ChatManager::new(deps.clone());
    mgr.recover_stale_working_state();
    assert_eq!(
        deps.chats_get("w1").unwrap().unwrap().process_state,
        Some(Some(ProcessState::Idle))
    );
    assert_eq!(
        deps.chats_get("w2").unwrap().unwrap().process_state,
        Some(Some(ProcessState::Idle))
    );
    assert_eq!(
        deps.chats_get("ok").unwrap().unwrap().process_state,
        Some(Some(ProcessState::Idle))
    );
}

// ── Command routing ──────────────────────

fn cmd_chat() -> Chat {
    let mut c = test_chat("chat-1");
    c.title = Some("Test chat".to_string());
    c.process_state = Some(Some(ProcessState::Idle));
    c
}

fn cmd_manager() -> (ChatManager, Arc<RecSession>) {
    let deps = FakeDeps::with_chats(vec![cmd_chat()]);
    let mgr = ChatManager::new(deps);
    let session = RecSession::new("chat-1", false, true);
    seed_active(&mgr, "chat-1", cmd_chat(), session.clone());
    (mgr, session)
}

#[tokio::test]
async fn calls_send_command_when_source_is_a_provider() {
    let (mgr, session) = cmd_manager();
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
    let cmds = session.send_command_calls.lock().unwrap();
    assert_eq!(cmds.len(), 1);
    assert_eq!(cmds[0].0, "compact");
    assert!(session.send_message_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn calls_send_command_with_args_when_provided() {
    let (mgr, session) = cmd_manager();
    mgr.send_message(
        "chat-1",
        "/init --scope project",
        None,
        Some(CommandMeta {
            name: "init".to_string(),
            source: "claude".to_string(),
            args: Some("--scope project".to_string()),
        }),
    )
    .await
    .unwrap();
    let cmds = session.send_command_calls.lock().unwrap();
    assert_eq!(cmds.len(), 1);
    assert_eq!(cmds[0].0, "init");
    assert_eq!(cmds[0].1.as_deref(), Some("--scope project"));
}

#[tokio::test]
async fn calls_send_message_with_wrapped_content_when_source_is_mainframe() {
    let (mgr, session) = cmd_manager();
    mgr.send_message(
        "chat-1",
        "/greet",
        None,
        Some(CommandMeta {
            name: "greet".to_string(),
            source: "mainframe".to_string(),
            args: Some("Say hello".to_string()),
        }),
    )
    .await
    .unwrap();
    let calls = session.send_message_calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].0.contains("<mainframe-command name=\"greet\""));
    assert!(calls[0].0.contains("Say hello"));
    assert!(calls[0].0.contains("<mainframe-command-response"));
    assert!(session.send_command_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn updates_process_state_to_working_after_command_routing() {
    let deps = FakeDeps::with_chats(vec![cmd_chat()]);
    let mgr = ChatManager::new(deps.clone());
    seed_active(
        &mgr,
        "chat-1",
        cmd_chat(),
        RecSession::new("chat-1", false, true),
    );
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
    assert!(
        deps.store
            .updates
            .lock()
            .unwrap()
            .iter()
            .any(|(id, p)| id == "chat-1" && p.process_state == Some(Some(ProcessState::Working)))
    );
}

#[tokio::test]
async fn calls_plain_send_message_with_raw_content_when_no_metadata() {
    let (mgr, session) = cmd_manager();
    mgr.send_message("chat-1", "Hello world", None, None)
        .await
        .unwrap();
    let calls = session.send_message_calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "Hello world");
    assert!(session.send_command_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn sends_unknown_slash_command_as_plain_text() {
    let (mgr, session) = cmd_manager();
    mgr.send_message("chat-1", "/insights", None, None)
        .await
        .unwrap();
    let calls = session.send_message_calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "/insights");
    assert!(session.send_command_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn sends_unknown_slash_command_with_args_as_plain_text() {
    let (mgr, session) = cmd_manager();
    mgr.send_message("chat-1", "/branch feature/my-feature", None, None)
        .await
        .unwrap();
    let calls = session.send_message_calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "/branch feature/my-feature");
    assert!(session.send_command_calls.lock().unwrap().is_empty());
}

// ── command-first title (#257) ───────────────────────────────────────────────

fn title_cmd_manager(title: Option<&str>) -> (ChatManager, Arc<FakeDeps>, Arc<RecSession>) {
    let mut chat = test_chat("chat-1");
    chat.title = title.map(str::to_string);
    chat.process_state = Some(Some(ProcessState::Idle));
    let deps = FakeDeps::with_chats(vec![chat.clone()]);
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("chat-1", false, true);
    seed_active(&mgr, "chat-1", chat, session.clone());
    (mgr, deps, session)
}
