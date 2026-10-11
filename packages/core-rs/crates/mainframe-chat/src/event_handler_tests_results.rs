#[tokio::test]
async fn on_result_retires_a_pending_fork_and_removes_its_snapshot_dir() {
    let snapshot = tempfile::tempdir().unwrap();
    let snapshot_dir = snapshot.path().to_string_lossy().into_owned();
    let h = Harness::new(cell(ProcessState::Working, None));
    h.deps.set_pending_fork(
        "c1",
        PendingForkState {
            fork_source: mainframe_types::adapter::ForkSource {
                source_session_id: "parent-session".to_string(),
                resume_path: Some(format!("{snapshot_dir}/parent-session.jsonl")),
                last_turn_id: None,
            },
            snapshot_dir: snapshot_dir.clone(),
            provisional_title: "Untitled (fork)".to_string(),
        },
    );
    let sink = h.sink("c1");

    sink.on_result(result("success", Some(false)));

    // The DB column clears synchronously, inside `on_result` itself.
    assert!(h.deps.get_pending_fork("c1").unwrap().is_none());

    // The directory removal is spawned fire-and-forget; poll for it rather
    // than assume a fixed delay.
    mainframe_runtime::test_support::poll_until(
        std::time::Duration::from_secs(10),
        std::time::Duration::from_millis(5),
        async || {
        if !std::path::Path::new(&snapshot_dir).exists() {
            return true;
        }
            false
        },
    ).await.expect("expected state before timeout");
    assert!(
        !std::path::Path::new(&snapshot_dir).exists(),
        "snapshot directory should have been removed"
    );
}

#[tokio::test]
async fn on_result_is_a_no_op_for_a_chat_with_no_pending_fork() {
    let h = Harness::new(cell(ProcessState::Working, None));
    let sink = h.sink("c1");

    sink.on_result(result("success", Some(false)));

    assert!(h.deps.get_pending_fork("c1").unwrap().is_none());
}

#[test]
fn emits_a_transient_system_message_carrying_turn_duration_ms() {
    let started_at = now_ms() - 1500;
    let h = Harness::new(cell_named(
        "chat-timing",
        ProcessState::Working,
        Some(started_at),
    ));
    let messages = h.messages();
    let sink = h.sink("chat-timing");

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
    let h = Harness::new(cell_named("chat-timing", ProcessState::Working, None));
    let messages = h.messages();
    let sink = h.sink("chat-timing");

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
