use super::idle_compaction_tests::{compactor, fixture};
use super::idle_test_session::IdleTestSession;
use super::*;
use mainframe_db::idle_compaction_queue::DeliveryState;
use mainframe_types::sync::LockExt as _;

#[tokio::test(flavor = "multi_thread")]
async fn rejection_survives_history_reload_and_retries_original_uuid() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    let reservation = manager.lifecycle.try_claim_maintenance("c").unwrap();
    manager
        .send_message("c", "keep me", None, None)
        .await
        .unwrap();
    drop(reservation);
    manager
        .enqueue_maintenance_input("c", "next", None, None)
        .await
        .unwrap();
    let original = deps.idle_queue_list("c").unwrap()[0].clone();
    *session.send_failure.lock_recover() = Some(AdapterError::StdinFull("test".into()));
    assert!(manager.drain_maintenance_queue("c").await.is_err());
    let retained = deps.idle_queue_list("c").unwrap();
    assert_eq!(retained.len(), 2);
    assert_eq!(retained[0].uuid, original.uuid);
    assert_eq!(retained[0].prepared_text, original.prepared_text);
    assert_eq!(retained[0].delivery, DeliveryState::Rejected);
    let manager = reload(&manager, deps.clone());
    let history = manager.shared.merge_idle_history("c", Vec::new()).unwrap();
    assert_eq!(history[0].id, original.message.id);
    assert_eq!(
        manager.get_queued_for_chat("c")[0].delivery.as_deref(),
        Some("rejected")
    );
    manager.drain_maintenance_queue("c").await.unwrap();
    assert_eq!(session.sent.lock_recover().len(), 1);
    manager
        .edit_queued_message("c", &original.message.id, "keep me")
        .await
        .unwrap();
    manager.drain_maintenance_queue("c").await.unwrap();
    let sent = session.sent.lock_recover();
    assert_eq!(sent.len(), 3);
    assert_eq!(sent[1].1.as_deref(), Some(original.uuid.as_str()));
    assert_eq!(sent[1].0, "keep me");
    assert_eq!(sent[2].0, "next");
    assert!(deps.idle_queue_list("c").unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn ambiguous_delivery_never_replays_and_cancel_releases_remaining_fifo() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    let reservation = manager.lifecycle.try_claim_maintenance("c").unwrap();
    manager
        .send_message("c", "uncertain", None, None)
        .await
        .unwrap();
    drop(reservation);
    manager
        .enqueue_maintenance_input("c", "next", None, None)
        .await
        .unwrap();
    *session.send_failure.lock_recover() = Some(AdapterError::Timeout("test"));
    assert!(manager.drain_maintenance_queue("c").await.is_err());
    let original = deps.idle_queue_list("c").unwrap()[0].clone();
    assert_eq!(original.delivery, DeliveryState::Unconfirmed);
    let manager = reload(&manager, deps.clone());
    let history = manager.shared.merge_idle_history("c", Vec::new()).unwrap();
    assert_eq!(history[0].id, original.message.id);
    assert_eq!(
        manager.get_queued_for_chat("c")[0].delivery.as_deref(),
        Some("unconfirmed")
    );
    assert!(
        manager
            .edit_queued_message("c", &original.message.id, "retry")
            .await
            .is_err()
    );
    manager.drain_maintenance_queue("c").await.unwrap();
    assert_eq!(session.sent.lock_recover().len(), 1);
    manager
        .cancel_queued_message("c", &original.message.id)
        .await
        .unwrap();
    manager.drain_maintenance_queue("c").await.unwrap();
    assert_eq!(session.sent.lock_recover()[1].0, "next");
    assert!(deps.idle_queue_list("c").unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn crash_during_dispatch_keeps_payload_and_never_auto_replays() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    manager
        .enqueue_maintenance_input("c", "not lost", None, None)
        .await
        .unwrap();
    let input = deps.idle_queue_list("c").unwrap().remove(0);
    session
        .hold_send
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let dispatch = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.drain_maintenance_queue("c").await })
    };
    session.send_started.notified().await;
    dispatch.abort();
    assert!(dispatch.await.unwrap_err().is_cancelled());
    let reloaded = Arc::new(ChatManager::new(deps.clone()));
    reloaded.dispose();
    reloaded.shared.merge_idle_history("c", Vec::new()).unwrap();
    reloaded.drain_maintenance_queue("c").await.unwrap();
    let stored = deps.idle_queue_list("c").unwrap();
    assert_eq!(stored[0].uuid, input.uuid);
    assert_eq!(stored[0].prepared_text, "not lost");
    assert_eq!(
        reloaded.get_queued_for_chat("c")[0].delivery.as_deref(),
        Some("unconfirmed")
    );
    assert_eq!(session.sent.lock_recover().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn production_codex_mapper_records_success_anchor_and_enables_idle_claim() {
    use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
    let mut fake = IdleTestSession::new();
    fake.inner.adapter = Some("codex".into());
    let (manager, deps, session) = fixture(fake).await;
    let sink = session.sink.lock_recover().as_ref().unwrap().clone();
    let mut state = CodexSessionState::default();
    for status in ["unknown", "failed", "interrupted", "completed"] {
        manager
            .mark_turn_accepted(&manager.shared.active("c").unwrap(), "c")
            .unwrap();
        handle_notification(
            "turn/started",
            &serde_json::json!({"turn":{"id":"real"}}),
            &sink,
            &mut state,
        );
        handle_notification(
            "turn/completed",
            &serde_json::json!({"turn":{"id":"real","status":status}}),
            &sink,
            &mut state,
        );
        let run = deps.idle_run_get("c").unwrap().unwrap();
        assert_eq!(
            run.completed_ms.is_some(),
            status == "completed",
            "{status}"
        );
    }
    let run = deps.idle_run_get("c").unwrap().unwrap();
    let due = run.completed_ms.unwrap() + 27 * 60_000;
    let mut compactor = compactor(&manager);
    compactor.now = Arc::new(move || due);
    session.finish.notify_one();
    compactor.evaluate("c").await;
    assert_eq!(session.requests.lock_recover().len(), 1);
    assert!(deps.idle_run_get("c").unwrap().unwrap().claim.is_some());
}

#[tokio::test(flavor = "multi_thread")]
async fn rejected_provider_command_keeps_original_payload_for_retry() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    manager
        .enqueue_maintenance_input(
            "c",
            "command text",
            None,
            Some(CommandMeta {
                name: "explain".into(),
                source: "commands".into(),
                args: Some("argument".into()),
            }),
        )
        .await
        .unwrap();
    let input = deps.idle_queue_list("c").unwrap()[0].clone();
    *session.send_failure.lock_recover() = Some(AdapterError::DeliveryRejected("rejected".into()));
    assert!(manager.drain_maintenance_queue("c").await.is_err());
    let retained = deps.idle_queue_list("c").unwrap().remove(0);
    assert_eq!(retained.uuid, input.uuid);
    assert_eq!(retained.delivery, DeliveryState::Rejected);
    assert_eq!(retained.command.unwrap().args.as_deref(), Some("argument"));
    manager
        .edit_queued_message("c", &input.message.id, "command text")
        .await
        .unwrap();
    manager.drain_maintenance_queue("c").await.unwrap();
    assert_eq!(session.sent.lock_recover()[1].0, "/explain argument");
    assert!(deps.idle_queue_list("c").unwrap().is_empty());
}

fn reload(manager: &ChatManager, deps: Arc<crate::test_support::FakeDeps>) -> Arc<ChatManager> {
    let reloaded = Arc::new(ChatManager::new(deps));
    reloaded.dispose();
    reloaded
        .shared
        .active_chats
        .insert("c".into(), manager.shared.active("c").unwrap());
    let history = reloaded.shared.merge_idle_history("c", Vec::new()).unwrap();
    reloaded.shared.messages.lock_recover().set("c", history);
    reloaded
}
