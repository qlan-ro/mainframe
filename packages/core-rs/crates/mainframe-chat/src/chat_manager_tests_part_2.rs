// ── CLI queue ───────────────────────────────────────────

#[tokio::test]
async fn writes_to_cli_immediately_with_uuid_and_records_queued_ref() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", true, true);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );

    mgr.send_message("c1", "hello while busy", None, None)
        .await
        .unwrap();

    let calls = session.send_message_calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].1.is_some(), "sendMessage carried a uuid");
    drop(calls);
    assert_eq!(mgr.get_queued_for_chat("c1").len(), 1);
}

#[tokio::test]
async fn steer_folds_into_a_working_turn_and_refuses_an_idle_one() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps);
    let session = RecSession::new("c1", true, true);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );

    mgr.steer_message("c1", "also run the tests").await.unwrap();
    assert_eq!(
        *session.steer_calls.lock().unwrap(),
        vec!["also run the tests".to_string()]
    );
    assert!(session.send_message_calls.lock().unwrap().is_empty());

    let idle = RecSession::new("c2", true, true);
    seed_active(
        &mgr,
        "c2",
        working_chat("c2", Some("t"), false),
        idle.clone(),
    );
    assert!(mgr.steer_message("c2", "x").await.is_err());
    assert!(idle.steer_calls.lock().unwrap().is_empty());
}

/// A steer that races the turn's own end (Codex rejects `turn/steer` once the
/// `expectedTurnId` it names has ended, `turn_steer.rs`) must not leave the
/// chat falsely marked Working: nothing else will ever flip it back, since
/// the real turn already finished. Steering never needs to (re)assert
/// Working at all, so the fix is that it never writes `process_state`.
#[tokio::test]
async fn a_steer_that_loses_the_turn_end_race_does_not_relatch_working() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", true, true);
    *session.steer_err.lock().unwrap() = Some("turn already ended".to_string());
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );

    let err = mgr.steer_message("c1", "also run the tests").await;
    assert!(err.is_err());
    assert!(session.steer_calls.lock().unwrap().is_empty());
    // Steering must never write `process_state`, successful or not: a new
    // turn's `set_working` is the only legitimate source of that patch.
    assert!(
        deps.store
            .updates
            .lock()
            .unwrap()
            .iter()
            .all(|(_, patch)| patch.process_state.is_none()),
        "steer must not (re)assert the chat's working state"
    );
    // A failed steer calls the adapter before storing anything: the CLI
    // never received this message, so it must not appear in the
    // transcript as if it had been.
    assert!(
        mgr.get_messages("c1").await.is_empty(),
        "a failed steer must not store a message the CLI never received"
    );
}

/// Review follow-up on 3c86aa74: a steer into a replay-ack adapter (Claude)
/// is also a queued send (`queued_message_metadata`'s `is_queued`), and must
/// go through the same `record_queued_ref`/wait-for-the-ack bookkeeping an
/// ordinary queued `send_message` does — not fire `TurnStarted` itself, or
/// the chat gets that transition twice: once here, once on the replay ack
/// (`on_queued_processed`).
#[tokio::test]
async fn a_queued_steer_records_a_ref_instead_of_restarting_the_turn() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", true, true);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );
    deps.emitter.events.lock().unwrap().clear();

    mgr.steer_message("c1", "also run the tests").await.unwrap();

    assert_eq!(
        *session.steer_calls.lock().unwrap(),
        vec!["also run the tests".to_string()]
    );
    assert_eq!(
        mgr.get_queued_for_chat("c1").len(),
        1,
        "a steer the adapter also replay-acks must record a queued ref"
    );
    assert!(
        mgr.get_messages("c1").await.iter().any(|m| {
            m.content.iter().any(|c| {
                matches!(
                    c,
                    mainframe_types::chat::MessageContent::Leaf(
                        mainframe_types::content::LeafContent::Text { text, .. },
                    ) if text.contains("also run the tests")
                )
            })
        }),
        "the steered message is stored, not just queued"
    );
}

#[tokio::test]
async fn handle_queued_processed_deletes_the_ref() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps);
    let session = RecSession::new("c1", true, true);
    seed_active(&mgr, "c1", working_chat("c1", Some("t"), true), session);

    mgr.send_message("c1", "hi", None, None).await.unwrap();
    let uuid = mgr.get_queued_for_chat("c1")[0].uuid.clone();
    mgr.handle_queued_processed("c1", &uuid);
    assert_eq!(mgr.get_queued_for_chat("c1").len(), 0);
}

#[tokio::test]
async fn cancel_success_removes_the_bubble_and_emits_cancelled() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", true, true);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );

    mgr.send_message("c1", "to cancel", None, None)
        .await
        .unwrap();
    let r = mgr.get_queued_for_chat("c1")[0].clone();
    mgr.cancel_queued_message("c1", &r.message_id)
        .await
        .unwrap();

    assert_eq!(
        session.cancel_calls.lock().unwrap().as_slice(),
        std::slice::from_ref(&r.uuid)
    );
    assert_eq!(mgr.get_queued_for_chat("c1").len(), 0);
}

#[tokio::test]
async fn cancel_lost_race_emits_nothing_and_keeps_the_ref() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", true, false); // CLI already consumed it
    seed_active(&mgr, "c1", working_chat("c1", Some("t"), true), session);

    mgr.send_message("c1", "racey", None, None).await.unwrap();
    let r = mgr.get_queued_for_chat("c1")[0].clone();
    deps.emitter.events.lock().unwrap().clear();

    mgr.cancel_queued_message("c1", &r.message_id)
        .await
        .unwrap();

    assert_eq!(mgr.get_queued_for_chat("c1").len(), 1);
    assert_eq!(deps.events().len(), 0);
}

#[tokio::test]
async fn edit_lost_race_silently_discards_the_edit() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", true, false);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );

    mgr.send_message("c1", "original", None, None)
        .await
        .unwrap();
    let r = mgr.get_queued_for_chat("c1")[0].clone();
    session.send_message_calls.lock().unwrap().clear();
    deps.emitter.events.lock().unwrap().clear();

    mgr.edit_queued_message("c1", &r.message_id, "edited")
        .await
        .unwrap();

    assert!(session.send_message_calls.lock().unwrap().is_empty());
    assert_eq!(deps.events().len(), 0);
    assert_eq!(mgr.get_queued_for_chat("c1").len(), 1);
}

// ── Turn timing ─────────────────────────────────────────

#[tokio::test]
async fn stamps_turn_started_at_right_before_dispatching_to_the_cli() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps);
    let session = RecSession::new("c1", false, true);
    seed_active(&mgr, "c1", working_chat("c1", Some("t"), false), session);
    let cell = mgr.get_active("c1").unwrap();
    assert!(cell.lock().unwrap().turn_started_at.is_none());

    let before = now_ms();
    mgr.send_message("c1", "hello", None, None).await.unwrap();
    let after = now_ms();

    let ts = cell.lock().unwrap().turn_started_at.unwrap();
    assert!(ts >= before && ts <= after);
}

// ── Working-state recovery ─────────────────────────────────────

fn stored(id: &str, ps: Option<Option<ProcessState>>) -> Chat {
    let mut c = test_chat(id);
    c.process_state = ps;
    c
}

#[tokio::test]
async fn resets_a_working_chat_to_idle() {
    let deps = FakeDeps::with_chats(vec![
        stored("c-working", Some(Some(ProcessState::Working))),
        stored("c-idle", Some(Some(ProcessState::Idle))),
        stored("c-null", Some(None)),
    ]);
    let mgr = ChatManager::new(deps.clone());
    mgr.recover_stale_working_state();
    assert_eq!(
        deps.chats_get("c-working").unwrap().unwrap().process_state,
        Some(Some(ProcessState::Idle))
    );
}
