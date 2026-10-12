#[tokio::test]
async fn provider_command_first_message_sets_the_fallback_title() {
    let (mgr, deps, session) = title_cmd_manager(None);

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

    let events = deps.events();
    let added = mgr.get_messages("chat-1").await;
    assert_eq!(added.len(), 1, "the user's message is still stored");
    let msg = &added[0];
    assert_eq!(msg.r#type, ChatMessageType::User);
    assert!(
        msg.metadata.is_none(),
        "a command send carries no transient metadata"
    );
    assert!(matches!(
        msg.content.as_slice(),
        [MessageContent::Leaf(LeafContent::Text { text, .. })] if text == "/compact"
    ));

    assert!(
        !events
            .iter()
            .any(|e| matches!(e, DaemonEvent::ContextUpdated { .. })),
        "a command send runs no attachment or mentions check"
    );

    {
        let cmds = session.send_command_calls.lock().unwrap();
        assert_eq!(cmds.len(), 1);
        assert_eq!(cmds[0].0, "compact");
    }
    assert!(session.send_message_calls.lock().unwrap().is_empty());

    assert!(
        deps.store
            .updates
            .lock()
            .unwrap()
            .iter()
            .any(|(id, p)| id == "chat-1" && p.process_state == Some(Some(ProcessState::Working))),
        "the chat still transitions to working"
    );

    assert_eq!(
        deps.chats_get("chat-1").unwrap().unwrap().title,
        Some("/compact".to_string())
    );
    assert!(events.iter().any(
        |e| matches!(e, DaemonEvent::ChatUpdated { chat, .. } if chat.title == Some("/compact".to_string()))
    ));
}

#[tokio::test]
async fn mainframe_command_first_message_titles_from_typed_text_not_the_wrapper() {
    let (mgr, deps, session) = title_cmd_manager(None);

    mgr.send_message(
        "chat-1",
        "/greet Say hello to the team",
        None,
        Some(CommandMeta {
            name: "greet".to_string(),
            source: "mainframe".to_string(),
            args: Some("Say hello".to_string()),
        }),
    )
    .await
    .unwrap();
    settle().await;

    let title = deps.chats_get("chat-1").unwrap().unwrap().title;
    assert_eq!(title.as_deref(), Some("/greet Say hello to the team"));
    let title = title.unwrap();
    assert!(!title.contains("<mainframe-command"));
    assert!(!title.contains("<mainframe-command-response"));

    let calls = deps.adapters.generate_title_calls.lock().unwrap().clone();
    assert_eq!(calls, vec!["/greet Say hello to the team".to_string()]);
    assert!(calls.iter().all(|c| !c.contains("<mainframe-command")));

    let sent = session.send_message_calls.lock().unwrap();
    assert!(sent[0].0.contains("<mainframe-command name=\"greet\""));
}

#[tokio::test]
async fn command_first_message_generated_title_overwrites_the_fallback() {
    let (mgr, deps, _session) = title_cmd_manager(None);
    *deps.adapters.generated_title.lock().unwrap() = Some("Compact the session".to_string());

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

    let mut titles: Vec<Option<String>> = deps
        .events()
        .iter()
        .filter_map(|e| match e {
            DaemonEvent::ChatUpdated { chat, .. } => Some(chat.title.clone()),
            _ => None,
        })
        .collect();
    titles.dedup();
    assert_eq!(
        titles,
        vec![
            Some("/compact".to_string()),
            Some("Compact the session".to_string())
        ]
    );
    assert_eq!(titles.first(), Some(&Some("/compact".to_string())));
    assert_eq!(
        titles.last(),
        Some(&Some("Compact the session".to_string()))
    );
    assert!(!titles.iter().any(|t| t.is_none()));

    assert_eq!(
        titles_written(&deps),
        vec!["/compact".to_string(), "Compact the session".to_string()]
    );
    assert_eq!(
        deps.chats_get("chat-1").unwrap().unwrap().title,
        Some("Compact the session".to_string())
    );
}

#[tokio::test]
async fn command_into_an_already_titled_chat_leaves_the_title_untouched() {
    let (mgr, deps, _session) = title_cmd_manager(Some("Test chat"));

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

    assert!(
        !deps
            .store
            .updates
            .lock()
            .unwrap()
            .iter()
            .any(|(_, p)| p.title.is_some())
    );
    assert!(deps.events().iter().all(|e| match e {
        DaemonEvent::ChatUpdated { chat, .. } => chat.title.as_deref() == Some("Test chat"),
        _ => true,
    }));
    assert!(
        deps.adapters
            .generate_title_calls
            .lock()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn title_generation_is_not_awaited_by_a_command_send() {
    let (mgr, deps, _session) = title_cmd_manager(None);
    *deps.adapters.generated_title.lock().unwrap() = Some("Compacted session".to_string());
    let gate = Arc::new(tokio::sync::Notify::new());
    *deps.adapters.title_gate.lock().unwrap() = Some(gate.clone());

    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        mgr.send_message(
            "chat-1",
            "/compact",
            None,
            Some(CommandMeta {
                name: "compact".to_string(),
                source: "claude".to_string(),
                args: None,
            }),
        ),
    )
    .await
    .expect("send must not await title generation")
    .unwrap();

    gate.notify_one();
    settle().await;

    assert_eq!(
        deps.chats_get("chat-1").unwrap().unwrap().title,
        Some("Compacted session".to_string())
    );
}

#[tokio::test]
async fn plain_text_first_message_still_titles_in_the_same_event_order() {
    let (mgr, deps, session) = title_cmd_manager(None);

    mgr.send_message("chat-1", "Hello world", None, None)
        .await
        .unwrap();

    assert_eq!(
        deps.chats_get("chat-1").unwrap().unwrap().title,
        Some("Hello world".to_string())
    );

    let updated: Vec<Chat> = deps
        .events()
        .into_iter()
        .filter_map(|e| match e {
            DaemonEvent::ChatUpdated { chat, .. } => Some(chat),
            _ => None,
        })
        .collect();
    let title_idx = updated
        .iter()
        .position(|c| c.title.as_deref().is_some_and(|t| !t.is_empty()))
        .expect("a ChatUpdated carried the title");
    let working_idx = updated
        .iter()
        .position(|c| c.process_state == Some(Some(ProcessState::Working)))
        .expect("a ChatUpdated carried Working");
    assert!(title_idx < working_idx);

    assert_eq!(session.send_message_calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn plain_text_first_message_with_a_session_reference_titles_from_the_visible_text() {
    let (mgr, deps, _session) = title_cmd_manager(None);
    let content = "Referenced session @session[Fix login bug]: /tmp/fix-login-bug.jsonl\n\nwhat did they change?";

    mgr.send_message("chat-1", content, None, None)
        .await
        .unwrap();
    settle().await;

    assert_eq!(
        deps.chats_get("chat-1").unwrap().unwrap().title,
        Some("what did they change?".to_string()),
        "the fallback title must not leak the raw reference preamble"
    );
    assert_eq!(
        deps.adapters.generate_title_calls.lock().unwrap().clone(),
        vec!["what did they change?".to_string()],
        "the LLM title call must not see the raw reference preamble either"
    );
}
