#[tokio::test]
async fn on_result_retires_a_pending_fork_and_removes_its_snapshot_dir() {
    let snapshot = tempfile::tempdir().unwrap();
    let snapshot_dir = snapshot.path().to_string_lossy().into_owned();
    let deps = FakeDeps::new(cell(ProcessState::Working, None), Vec::new());
    deps.set_pending_fork(PendingForkState {
        fork_source: mainframe_types::adapter::ForkSource {
            source_session_id: "parent-session".to_string(),
            resume_path: Some(format!("{snapshot_dir}/parent-session.jsonl")),
            last_turn_id: None,
        },
        snapshot_dir: snapshot_dir.clone(),
        provisional_title: "Untitled (fork)".to_string(),
    });
    let handler = EventHandler::new(
        Arc::new(Mutex::new(MessageCache::new())),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps.clone(),
    );
    let sink = handler.build_sink("c1", None);

    sink.on_result(result("success", Some(false)));

    // The DB column clears synchronously, inside `on_result` itself.
    assert!(deps.get_pending_fork("c1").is_none());

    // The directory removal is spawned fire-and-forget; poll for it rather
    // than assume a fixed delay.
    for _ in 0..200 {
        if !std::path::Path::new(&snapshot_dir).exists() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    assert!(
        !std::path::Path::new(&snapshot_dir).exists(),
        "snapshot directory should have been removed"
    );
}

#[tokio::test]
async fn on_result_is_a_no_op_for_a_chat_with_no_pending_fork() {
    let deps = FakeDeps::new(cell(ProcessState::Working, None), Vec::new());
    let handler = EventHandler::new(
        Arc::new(Mutex::new(MessageCache::new())),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps.clone(),
    );
    let sink = handler.build_sink("c1", None);

    sink.on_result(result("success", Some(false)));

    assert!(deps.get_pending_fork("c1").is_none());
}

#[test]
fn emits_a_transient_system_message_carrying_turn_duration_ms() {
    let started_at = now_ms() - 1500;
    let messages = Arc::new(Mutex::new(MessageCache::new()));
    let deps = FakeDeps::new(cell(ProcessState::Working, Some(started_at)), Vec::new());
    let handler = EventHandler::new(
        messages.clone(),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps.clone(),
    );
    let sink = handler.build_sink("chat-timing", None);

    sink.on_result(SessionResult {
        total_cost_usd: Some(0.01),
        usage: Some(MessageUsage {
            input_tokens: Some(10),
            output_tokens: Some(5),
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
        }),
        context_tokens: None,
        subtype: None,
        result: None,
        is_error: None,
    });

    let cache = messages.lock().unwrap();
    let timing = cache
        .get("chat-timing")
        .into_iter()
        .flatten()
        .find_map(|message| {
            if message.r#type != ChatMessageType::System {
                return None;
            }
            message
                .metadata
                .as_ref()
                .and_then(|md| md.get("turnDurationMs"))
                .and_then(|v| v.as_i64())
        });
    // measured from turnStartedAt (now - 1500) → ~1500ms; allow slack for wall time.
    let ms = timing.expect("turn timing message");
    assert!((1500..1700).contains(&ms), "turnDurationMs was {ms}");
}

#[test]
fn does_not_emit_turn_timing_when_turn_started_at_was_never_stamped() {
    let messages = Arc::new(Mutex::new(MessageCache::new()));
    let deps = FakeDeps::new(cell(ProcessState::Working, None), Vec::new());
    let handler = EventHandler::new(
        messages.clone(),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps.clone(),
    );
    let sink = handler.build_sink("chat-timing", None);

    sink.on_result(SessionResult {
        total_cost_usd: Some(0.0),
        usage: Some(MessageUsage {
            input_tokens: Some(0),
            output_tokens: Some(0),
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
        }),
        context_tokens: None,
        subtype: None,
        result: None,
        is_error: None,
    });

    let cache = messages.lock().unwrap();
    let has_timing = cache
        .get("chat-timing")
        .into_iter()
        .flatten()
        .any(|message| {
            message.r#type == ChatMessageType::System
                && message
                    .metadata
                    .as_ref()
                    .and_then(|md| md.get("turnDurationMs"))
                    .is_some()
        });
    assert!(!has_timing);
}
