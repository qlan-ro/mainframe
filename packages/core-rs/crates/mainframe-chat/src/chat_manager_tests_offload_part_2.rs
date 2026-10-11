/// The activity case can't be exercised through `scan_idle_sessions()` like
/// the permission/send cases above: `select_idle_candidates` itself filters
/// on activity, so a bump landing before `scan_idle_sessions`'s OWN fresh
/// selection pass would just silently drop the candidate before `offload()`
/// is even called — never reaching `ChatOffload::recheck`'s activity check at
/// all. Driving `IdleOffloader::offload` directly on the pre-selected id
/// (`offloader_for`, module doc above) is what actually exercises `recheck`.
#[tokio::test]
async fn ac4_activity_injected_after_selection_keeps_the_chat_live() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = seed_idle_chat(&mgr, Some(long_idle()));

    let candidates = select_idle_candidates(&mgr.shared.active_chats, now_ms(), IDLE_THRESHOLD_MS);
    assert_eq!(
        candidates,
        vec!["c1".to_string()],
        "selected before the race"
    );

    // The race: fresh activity lands after selection, before the offload's re-check.
    session.bump_activity(now_ms());

    let offloader = offloader_for(&mgr);
    offloader.offload("c1").await;

    assert_eq!(session.kills(), 0, "the chat stays live");
    assert!(mgr.shared.messages.lock().unwrap().get("c1").is_some());
    assert!(mgr.shared.active_chats.get("c1").is_some());
    assert!(offloaded_events(&deps).is_empty());
}

#[tokio::test]
async fn ac4_an_in_flight_send_injected_after_selection_keeps_the_chat_live() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = seed_idle_chat(&mgr, Some(long_idle()));

    let candidates = select_idle_candidates(&mgr.shared.active_chats, now_ms(), IDLE_THRESHOLD_MS);
    assert_eq!(
        candidates,
        vec!["c1".to_string()],
        "selected before the race"
    );

    // The race: a send registers after selection, before the offload runs.
    let send_guard = mgr.lifecycle.begin_send("c1").await;

    mgr.scan_idle_sessions().await;

    assert_eq!(session.kills(), 0, "the chat stays live");
    assert!(mgr.shared.messages.lock().unwrap().get("c1").is_some());
    assert!(offloaded_events(&deps).is_empty());
    drop(send_guard);
}

// ── AC5 ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ac5_scanning_twice_offloads_once() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = seed_idle_chat(&mgr, Some(long_idle()));

    mgr.scan_idle_sessions().await;
    mgr.scan_idle_sessions().await;

    assert_eq!(session.kills(), 1, "the process is killed exactly once");
    assert_eq!(
        offloaded_events(&deps),
        vec!["c1".to_string()],
        "exactly one chat.offloaded event"
    );
}

// ── AC6 ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ac6_display_history_survives_offload_and_loads_once_for_concurrent_readers() {
    let history = vec![history_message("m1"), history_message("m2")];
    let (deps, mgr) = seed_offloadable_chat_with_transcript(history.clone());

    mgr.scan_idle_sessions().await;
    assert!(
        mgr.shared.messages.lock().unwrap().get("c1").is_none(),
        "offloaded: cache is empty"
    );

    let (a, b) = tokio::join!(mgr.get_messages("c1"), mgr.get_messages("c1"));

    let ids = |ms: &[ChatMessage]| -> Vec<String> { ms.iter().map(|m| m.id.clone()).collect() };
    let expected_ids = ids(&history);
    assert_eq!(a.len(), history.len());
    assert_eq!(
        ids(&a),
        expected_ids,
        "same stable item ids as before offload"
    );
    assert_eq!(ids(&b), expected_ids);
    assert_eq!(
        deps.adapters
            .history_loads
            .load(std::sync::atomic::Ordering::SeqCst),
        1,
        "two concurrent readers, one transcript load"
    );
}

// ── AC7 ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ac7_get_messages_after_offload_does_not_touch_the_registry() {
    let (_deps, mgr) = seed_offloadable_chat_with_transcript(vec![history_message("m1")]);

    mgr.scan_idle_sessions().await;
    let _ = mgr.get_messages("c1").await;

    assert!(
        mgr.shared.active_chats.get("c1").is_none(),
        "reading history alone never spawns a CLI process"
    );
}

#[tokio::test]
async fn ac7_send_after_offload_reloads_prior_history_via_the_resume_path() {
    let (deps, mgr) =
        seed_offloadable_chat_with_transcript(vec![history_message("m1"), history_message("m2")]);
    // A real post-spawn send: without this, `require_live_session` fails
    // after `start_chat` and the send never reaches `store_user_message`,
    // which is exactly the assertion this test exists to make (AC7's "spawns
    // one... sending... starts with every pre-offload message, followed by
    // the new user message").
    deps.set_spawn_ok(true);

    mgr.scan_idle_sessions().await;
    assert!(
        mgr.shared.active_chats.get("c1").is_none(),
        "offloaded: no registry cell"
    );
    assert!(
        mgr.shared.messages.lock().unwrap().get("c1").is_none(),
        "offloaded: no cached messages"
    );

    // send -> start_chat -> do_start_chat (spawns with the resume anchor,
    // asserted below) -> load_chat -> do_load_chat reloads the transcript ->
    // dispatch stores the new user message on top.
    mgr.send_message("c1", "hello again", None, None)
        .await
        .expect("the resumed session now spawns successfully");

    assert!(
        mgr.shared.active_chats.get("c1").is_some(),
        "the resume path re-registered the chat"
    );

    let resume_session = deps
        .created_sessions()
        .into_iter()
        .find(|o| o.mainframe_chat_id == "c1")
        .expect("do_start_chat must have created a session for c1");
    assert_eq!(
        resume_session.chat_id,
        Some("sess-1".to_string()),
        "spawns with the stored CLI session id (the resume path)"
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
    assert_eq!(
        reloaded[2].r#type,
        ChatMessageType::User,
        "followed by the new user message"
    );
    assert!(
        reloaded[2]
            .content
            .iter()
            .any(|c| matches!(c, MessageContent::Leaf(LeafContent::Text { text, .. }) if text == "hello again")),
        "the new user message carries the text just sent"
    );

    assert_eq!(
        deps.adapters
            .history_loads
            .load(std::sync::atomic::Ordering::SeqCst),
        1,
        "one resume, one transcript load"
    );
}

/// "Chat on screen when offloaded" edge case: offload leaves an attached
/// facade session untouched (no `ChatEnded`), so it still holds the
/// pre-offload items under their OLD ids. Sending from that same screen
/// respawns and reloads the transcript (AC7), rebuilding the cache — the
/// reload must tell the attached session to `Resync` so it re-replays
/// against the reloaded graph instead of diffing old ids against new ones,
/// which would clear every earlier item by id and push it to the end,
/// scrambling the on-screen order ( review finding).
#[tokio::test]
async fn resend_from_an_attached_chat_after_offload_resyncs_instead_of_scrambling_order() {
    let (deps, mgr) =
        seed_offloadable_chat_with_transcript(vec![history_message("m1"), history_message("m2")]);
    let surface = RecordingSurface::arc();
    let mgr = mgr.with_chat_surface(surface.clone());
    deps.set_spawn_ok(true);

    mgr.scan_idle_sessions().await;
    assert!(
        mgr.shared.messages.lock().unwrap().get("c1").is_none(),
        "offloaded: no cached messages"
    );
    assert!(
        !surface
            .events()
            .iter()
            .any(|e| matches!(e, ChatSurfaceEvent::ChatEnded { .. })),
        "offload must not tell an attached session the chat ended"
    );

    // The same "on-screen" facade session is still attached; sending now
    // resumes and reloads the transcript under it (AC7's resume path).
    mgr.send_message("c1", "hello again", None, None)
        .await
        .expect("the resumed session now spawns successfully");

    assert!(
        surface
            .events()
            .iter()
            .any(|e| matches!(e, ChatSurfaceEvent::Resync { chat_id } if chat_id == "c1")),
        "reloading a chat with an attached session must resync it, \
         not leave it diffing stale live ids against the reloaded graph"
    );
}
