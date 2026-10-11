// ── races: selection vs. offload, on an unspawned cell ──────────

/// A send registered after selection (but before the offload's re-check)
/// keeps an unspawned, backdated cell live — `try_claim_offload`'s busy check
/// refuses the claim outright, same as the spawned-session AC4 case.
#[tokio::test]
async fn an_in_flight_send_injected_after_selection_keeps_an_unspawned_cell_live() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    seed_cell(&mgr, "c1", test_chat("c1"), None, long_idle());
    mgr.shared
        .messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);

    let candidates = select_idle_candidates(&mgr.shared.active_chats, now_ms(), IDLE_THRESHOLD_MS);
    assert_eq!(
        candidates,
        vec!["c1".to_string()],
        "selected before the race"
    );

    let send_guard = mgr.lifecycle.begin_send("c1").await;

    mgr.scan_idle_sessions().await;

    assert!(
        mgr.shared.active_chats.get("c1").is_some(),
        "the chat stays live"
    );
    assert!(offloaded_events(&deps).is_empty());
    drop(send_guard);
}

/// A touch (e.g. a claim-free config read) landing after selection but before
/// the offload's re-check keeps an unspawned cell live — `idle_since` reads
/// the bumped `last_used_at`, so `recheck` no longer sees it as idle. Driven
/// directly via `offloader_for`, same reasoning as the spawned-session
/// activity-race test: `scan_idle_sessions`'s own fresh selection would
/// otherwise just re-filter the candidate out before `recheck` ever ran.
#[tokio::test]
async fn a_touch_injected_after_selection_keeps_an_unspawned_cell_live() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    seed_cell(&mgr, "c1", test_chat("c1"), None, long_idle());
    mgr.shared
        .messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);

    let candidates = select_idle_candidates(&mgr.shared.active_chats, now_ms(), IDLE_THRESHOLD_MS);
    assert_eq!(
        candidates,
        vec!["c1".to_string()],
        "selected before the race"
    );

    // The race: a touch lands after selection, before the offload re-check.
    mgr.lifecycle.touch("c1");

    let offloader = offloader_for(&mgr);
    offloader.offload("c1").await;

    assert!(
        mgr.shared.active_chats.get("c1").is_some(),
        "the chat stays live"
    );
    assert!(mgr.shared.messages.lock().unwrap().get("c1").is_some());
    assert!(offloaded_events(&deps).is_empty());
}

// ──: pending/queued/Working still block an unspawned cell ───────

#[tokio::test]
async fn a_pending_permission_blocks_offload_of_an_unspawned_backdated_cell() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    seed_cell(&mgr, "c1", test_chat("c1"), None, long_idle());
    mgr.shared
        .messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);
    enqueue_pending_permission(&mgr);

    mgr.scan_idle_sessions().await;

    assert!(mgr.shared.active_chats.get("c1").is_some(), "stays live");
    assert!(offloaded_events(&deps).is_empty());
}

#[tokio::test]
async fn a_queued_message_blocks_offload_of_an_unspawned_backdated_cell() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    seed_cell(&mgr, "c1", test_chat("c1"), None, long_idle());
    mgr.shared
        .messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);
    mgr.shared
        .queued_refs
        .lock()
        .unwrap()
        .push(QueuedMessageRef {
            message_id: "m1".to_string(),
            chat_id: "c1".to_string(),
            uuid: "u1".to_string(),
            content: "queued".to_string(),
            attachment_ids: None,
            timestamp: String::new(),
        });

    mgr.scan_idle_sessions().await;

    assert!(mgr.shared.active_chats.get("c1").is_some(), "stays live");
    assert!(offloaded_events(&deps).is_empty());
}

#[tokio::test]
async fn a_working_process_state_blocks_offload_of_an_unspawned_backdated_cell() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let mut chat = test_chat("c1");
    chat.process_state = Some(Some(ProcessState::Working));
    seed_cell(&mgr, "c1", chat, None, long_idle());
    mgr.shared
        .messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);

    mgr.scan_idle_sessions().await;

    assert!(mgr.shared.active_chats.get("c1").is_some(), "stays live");
    assert!(offloaded_events(&deps).is_empty());
}

// ──: config entry points rebuild an offloaded cell ──────────────

#[tokio::test]
async fn update_chat_config_rebuilds_an_offloaded_cell_and_applies_the_new_model() {
    let mut chat = test_chat("c1");
    chat.model = Some("old-model".to_string());
    let deps = FakeDeps::with_chats(vec![chat.clone()]);
    *deps.adapters.history.lock().unwrap() = Some(Vec::new());
    let mgr = ChatManager::new(deps.clone());
    seed_cell(&mgr, "c1", chat, None, long_idle());
    mgr.shared
        .messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);

    mgr.scan_idle_sessions().await;
    assert!(
        mgr.shared.active_chats.get("c1").is_none(),
        "offloaded before the config edit"
    );

    mgr.update_chat_config("c1", None, Some("new-model".to_string()), None, None)
        .await
        .expect("the edit rebuilds the cell instead of failing not-found");

    assert!(
        mgr.shared.active_chats.get("c1").is_some(),
        "the cell is back"
    );
    assert_eq!(
        deps.chats_get("c1").unwrap().unwrap().model,
        Some("new-model".to_string()),
        "the stored chat carries the new model"
    );
    let active_model = mgr
        .shared
        .active_chats
        .get("c1")
        .unwrap()
        .value()
        .lock()
        .unwrap()
        .chat
        .model
        .clone();
    assert_eq!(
        active_model,
        Some("new-model".to_string()),
        "the rebuilt active chat carries the new model too"
    );
}

#[tokio::test]
async fn disable_worktree_rebuilds_an_offloaded_cell_and_clears_the_binding() {
    let mut chat = test_chat("c1");
    chat.worktree_path = Some("/tmp/mainframe-test-todo-381-wt".to_string());
    chat.branch_name = Some("feat/old".to_string());
    let deps = FakeDeps::with_chats(vec![chat.clone()]);
    *deps.adapters.history.lock().unwrap() = Some(Vec::new());
    let mgr = ChatManager::new(deps.clone());
    seed_cell(&mgr, "c1", chat, None, long_idle());
    mgr.shared
        .messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);

    mgr.scan_idle_sessions().await;
    assert!(
        mgr.shared.active_chats.get("c1").is_none(),
        "offloaded before the worktree edit"
    );

    mgr.disable_worktree("c1")
        .await
        .expect("the edit rebuilds the cell instead of silently no-oping");

    assert!(
        mgr.shared.active_chats.get("c1").is_some(),
        "the cell is back"
    );
    assert_eq!(
        deps.chats_get("c1").unwrap().unwrap().worktree_path,
        None,
        "the stored binding is cleared"
    );
    let active_worktree = mgr
        .shared
        .active_chats
        .get("c1")
        .unwrap()
        .value()
        .lock()
        .unwrap()
        .chat
        .worktree_path
        .clone();
    assert_eq!(
        active_worktree, None,
        "the rebuilt active chat's binding is cleared too"
    );
}
