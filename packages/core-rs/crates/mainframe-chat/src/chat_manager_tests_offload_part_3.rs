// ── R1: offload guard, resync producers ──────────────────────────

/// Finding 4: `ChatOffload::recheck` must not kill the CLI of a turn whose
/// tool is still running silently past the idle threshold — `is_spawned`/
/// `last_activity_at` alone can't see that.
#[tokio::test]
async fn a_working_chat_is_never_offloaded() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let mut chat = test_chat("c1");
    chat.process_state = Some(Some(mainframe_types::chat::ProcessState::Working));
    let session = FakeSession::with_activity(true, Some(long_idle()));
    seed_active(&mgr, "c1", chat, session.clone());
    mgr.shared
        .messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);

    mgr.scan_idle_sessions().await;

    assert_eq!(session.kills(), 0, "a working turn's CLI is never killed");
    assert!(
        mgr.shared.active_chats.get("c1").is_some(),
        "the registry cell remains"
    );
    assert!(
        mgr.shared.messages.lock().unwrap().get("c1").is_some(),
        "the cache remains"
    );
    assert!(offloaded_events(&deps).is_empty());
}

/// Finding 6: a cold chat's first send after `session/resume` must not force
/// a full replay — `do_load_chat`'s reload reproduces the exact same list
/// `get_messages` already cached, so no resync is warranted.
#[tokio::test]
async fn a_cold_opened_chat_sends_without_resync() {
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some("sess-1".to_string());
    let deps = FakeDeps::with_chats(vec![chat]);
    *deps.adapters.history.lock().unwrap() =
        Some(vec![history_message("m1"), history_message("m2")]);
    deps.set_spawn_ok(true);
    let mgr = ChatManager::new(deps.clone());
    let surface = RecordingSurface::arc();
    let mgr = mgr.with_chat_surface(surface.clone());

    let _ = mgr.get_messages("c1").await;
    mgr.send_message("c1", "hello", None, None)
        .await
        .expect("the cold chat spawns and sends");

    assert!(
        !surface
            .events()
            .iter()
            .any(|e| matches!(e, ChatSurfaceEvent::Resync { .. })),
        "an identical reload of an already-warm cache must not resync"
    );
}

/// Finding 5: `emit_worktree_missing_error` loads any existing history before
/// it appends, so the error lands after the chat's prior transcript instead
/// of replacing it.
#[tokio::test]
async fn worktree_missing_error_keeps_the_loaded_history() {
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some("sess-1".to_string());
    // `get_chat` recomputes `worktree_missing` from disk (`enrich_chat`), so
    // the fixture needs a worktree path that is actually absent rather than
    // the flag set directly.
    chat.worktree_path = Some("/tmp/mainframe-test-missing-worktree-r1".to_string());
    let deps = FakeDeps::with_chats(vec![chat]);
    *deps.adapters.history.lock().unwrap() =
        Some(vec![history_message("m1"), history_message("m2")]);
    let mgr = ChatManager::new(deps.clone());

    mgr.send_message("c1", "hello", None, None)
        .await
        .expect("the worktree-missing branch returns Ok without sending");

    let messages = mgr.get_messages("c1").await;
    assert_eq!(messages.len(), 3, "history plus one error message");
    let ids: Vec<&str> = messages[..2].iter().map(|m| m.id.as_str()).collect();
    assert_eq!(
        ids,
        vec!["m1", "m2"],
        "the loaded history survives, with the error appended after it"
    );
    assert_eq!(messages[2].r#type, ChatMessageType::Error);
}

// ──: idle offload for unspawned registry cells ──────────────────
//
// `ActiveChat::new` (every production insertion point) and `touch` (every use
// path) stamp `last_used_at` with the real clock, so these tests — like the
// AC1-7 suite above — need no injected fake clock: a cell is backdated once,
// directly, past the real `IDLE_THRESHOLD_MS`, and stays idle for the test's
// lifetime unless something re-touches it.

/// Insert `chat_id` with an explicit `session` (any spawn state, or `None`
/// for a cell that never spawned at all) and an explicit backdated
/// `last_used_at` — deliberately bypassing the fresh-clock stamp
/// `ActiveChat::new` normally applies, the same way `seed_idle_chat` bypasses
/// a spawned session's real `last_activity_at` by injecting it directly.
fn seed_cell(
    mgr: &ChatManager,
    chat_id: &str,
    chat: Chat,
    session: Option<Arc<dyn AdapterSession>>,
    last_used_at: i64,
) {
    let mut active = ActiveChat::new(chat, session);
    active.last_used_at = last_used_at;
    mgr.shared
        .active_chats
        .insert(chat_id.to_string(), Arc::new(Mutex::new(active)));
}

fn minimal_new_chat() -> NewChat {
    NewChat {
        project_id: "p1".to_string(),
        adapter_id: "claude".to_string(),
        model: None,
        permission_mode: None,
        automation_run_id: None,
        temporary: false,
        scratch_root: None,
    }
}

/// (a) A never-sent chat (`create_chat`, no session ever attached) backdated
/// past the threshold is offloaded: the cell, cache entry and pin are gone,
/// but the chat row survives, unarchived.
#[tokio::test]
async fn unspawned_never_sent_cell_offloads_once_backdated_past_the_threshold() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let chat = mgr.create_chat(minimal_new_chat()).await.unwrap();
    mgr.shared
        .messages
        .lock()
        .unwrap()
        .set(&chat.id, vec![history_message("m1")]);
    {
        let cell = mgr
            .shared
            .active_chats
            .get(&chat.id)
            .unwrap()
            .value()
            .clone();
        cell.lock().unwrap().last_used_at = long_idle();
    }

    mgr.scan_idle_sessions().await;

    assert!(
        mgr.shared.active_chats.get(&chat.id).is_none(),
        "the registry cell is gone"
    );
    assert!(
        mgr.shared.messages.lock().unwrap().get(&chat.id).is_none(),
        "the cache entry is gone"
    );
    assert!(
        !mgr.shared.messages.lock().unwrap().is_pinned(&chat.id),
        "the pin is released"
    );
    let stored = deps
        .chats_get(&chat.id)
        .unwrap()
        .expect("the chat row survives");
    assert_ne!(stored.status, ChatStatus::Archived, "not archived");
    assert_eq!(offloaded_events(&deps), vec![chat.id.clone()]);
}

/// (b) A REST-resume-style cell: an unspawned `FakeSession` handle (a failed
/// spawn, or a resume that never started) plus a transcript already cached.
/// Backdated and offloaded, a send then succeeds and reloads the exact
/// pre-offload history under its stable ids, followed by the new message —
/// the AC7 pattern, for a cell that never had a live process to begin with.
#[tokio::test]
async fn unspawned_session_handle_offloads_and_a_later_send_resumes_cleanly() {
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some("sess-1".to_string());
    let history = vec![history_message("m1"), history_message("m2")];
    let deps = FakeDeps::with_chats(vec![chat.clone()]);
    *deps.adapters.history.lock().unwrap() = Some(history.clone());
    deps.set_spawn_ok(true);
    let mgr = ChatManager::new(deps.clone());
    let session: Arc<dyn AdapterSession> = FakeSession::with_activity(false, None);
    seed_cell(&mgr, "c1", chat, Some(session), long_idle());
    mgr.shared.messages.lock().unwrap().set("c1", history);

    mgr.scan_idle_sessions().await;
    assert!(
        mgr.shared.active_chats.get("c1").is_none(),
        "offloaded: no registry cell"
    );
    assert!(
        mgr.shared.messages.lock().unwrap().get("c1").is_none(),
        "offloaded: no cached messages"
    );
    assert_eq!(offloaded_events(&deps), vec!["c1".to_string()]);

    mgr.send_message("c1", "hello again", None, None)
        .await
        .expect("the resumed session now spawns successfully");

    assert!(
        mgr.shared.active_chats.get("c1").is_some(),
        "the resume path re-registered the chat"
    );
    let reloaded = mgr
        .shared
        .messages
        .lock()
        .unwrap()
        .get("c1")
        .cloned()
        .unwrap_or_default();
    assert_eq!(
        reloaded.len(),
        3,
        "every pre-offload message, followed by the new user message"
    );
    let ids: Vec<&str> = reloaded.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(
        &ids[..2],
        ["m1", "m2"],
        "history starts with every pre-offload message"
    );
}

/// (c) A freshly created or freshly loaded chat is not offloaded by a scan —
/// the fresh `last_used_at` an insertion stamps keeps it live.
#[tokio::test]
async fn a_freshly_created_chat_is_not_offloaded_by_a_scan() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let chat = mgr.create_chat(minimal_new_chat()).await.unwrap();

    mgr.scan_idle_sessions().await;

    assert!(
        mgr.shared.active_chats.get(&chat.id).is_some(),
        "a fresh last_used_at keeps it live"
    );
    assert!(offloaded_events(&deps).is_empty());
}

#[tokio::test]
async fn a_freshly_loaded_chat_is_not_offloaded_by_a_scan() {
    let chat = test_chat("c1");
    let deps = FakeDeps::with_chats(vec![chat]);
    *deps.adapters.history.lock().unwrap() = Some(Vec::new());
    let mgr = ChatManager::new(deps.clone());

    mgr.load_chat("c1").await;
    mgr.scan_idle_sessions().await;

    assert!(mgr.shared.active_chats.get("c1").is_some());
    assert!(offloaded_events(&deps).is_empty());
}
