#[test]
fn moves_the_acked_message_to_the_end_strips_metadata_and_deletes_the_ref() {
    let messages = Arc::new(Mutex::new(MessageCache::new()));
    messages
        .lock()
        .unwrap()
        .append("c1", umsg("q", Some(queued_meta("u1"))));
    messages
        .lock()
        .unwrap()
        .append("c1", umsg("assistant-reply", None));
    let refs = vec![QueuedMessageRef {
        message_id: "q".to_string(),
        chat_id: "c1".to_string(),
        uuid: "u1".to_string(),
        content: "q".to_string(),
        attachment_ids: None,
        timestamp: String::new(),
    }];
    let deps = FakeDeps::new(cell(ProcessState::Working, None), refs);
    let handler = EventHandler::new(
        messages.clone(),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps.clone(),
    );
    let surface = Arc::new(QueueSurface::default());
    handler.set_chat_surface(surface.clone());
    let sink = handler.build_sink("c1", None);
    sink.on_queued_processed("u1");
    assert_eq!(ids(&messages), vec!["assistant-reply", "q"]);
    let moved = messages.lock().unwrap();
    let m = moved
        .get("c1")
        .unwrap()
        .iter()
        .find(|m| m.id == "q")
        .unwrap()
        .clone();
    drop(moved);
    assert!(
        m.metadata
            .as_ref()
            .and_then(|md| md.get("queued"))
            .is_none()
    );
    assert!(m.metadata.as_ref().and_then(|md| md.get("uuid")).is_none());
    assert_eq!(deps.refs.lock().unwrap().len(), 0);
    assert_eq!(surface.snapshots(), vec![Vec::new()]);
}
#[test]
fn moves_an_orphan_queued_message_to_the_end_and_goes_idle() {
    let messages = Arc::new(Mutex::new(MessageCache::new()));
    messages
        .lock()
        .unwrap()
        .append("c1", umsg("q", Some(queued_meta("u1"))));
    messages
        .lock()
        .unwrap()
        .append("c1", umsg("assistant-reply", None));
    let cell = cell(ProcessState::Working, None);
    let deps = FakeDeps::new(cell.clone(), Vec::new());
    let handler = EventHandler::new(
        messages.clone(),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps.clone(),
    );
    let sink = handler.build_sink("c1", None);
    sink.on_result(SessionResult {
        total_cost_usd: Some(0.0),
        usage: None,
        context_tokens: None,
        subtype: Some("success".to_string()),
        result: None,
        is_error: Some(false),
    });
    assert_eq!(ids(&messages), vec!["assistant-reply", "q"]);
    let m = messages.lock().unwrap();
    let q = m
        .get("c1")
        .unwrap()
        .iter()
        .find(|m| m.id == "q")
        .unwrap()
        .clone();
    drop(m);
    assert!(
        q.metadata
            .as_ref()
            .and_then(|md| md.get("queued"))
            .is_none()
    );
    assert_eq!(
        cell.lock().unwrap().chat.process_state,
        Some(Some(ProcessState::Idle))
    );
}
#[test]
fn moves_all_orphan_queued_messages_to_the_end() {
    let messages = Arc::new(Mutex::new(MessageCache::new()));
    messages
        .lock()
        .unwrap()
        .append("c1", umsg("q1", Some(queued_meta("u1"))));
    messages
        .lock()
        .unwrap()
        .append("c1", umsg("q2", Some(queued_meta("u2"))));
    messages
        .lock()
        .unwrap()
        .append("c1", umsg("assistant-reply", None));
    let deps = FakeDeps::new(cell(ProcessState::Working, None), Vec::new());
    let handler = EventHandler::new(
        messages.clone(),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps.clone(),
    );
    let surface = Arc::new(QueueSurface::default());
    handler.set_chat_surface(surface.clone());
    let sink = handler.build_sink("c1", None);
    sink.on_result(SessionResult {
        total_cost_usd: Some(0.0),
        usage: None,
        context_tokens: None,
        subtype: Some("success".to_string()),
        result: None,
        is_error: Some(false),
    });
    assert_eq!(ids(&messages), vec!["assistant-reply", "q1", "q2"]);
    let m = messages.lock().unwrap();
    let q2 = m
        .get("c1")
        .unwrap()
        .iter()
        .find(|m| m.id == "q2")
        .unwrap()
        .clone();
    drop(m);
    assert!(
        q2.metadata
            .as_ref()
            .and_then(|md| md.get("queued"))
            .is_none()
    );
    assert_eq!(surface.snapshots().last(), Some(&Vec::new()));
}
