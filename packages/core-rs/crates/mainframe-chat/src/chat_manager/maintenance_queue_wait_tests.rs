use super::*;
use crate::chat_manager::{idle_compaction_tests::fixture, idle_test_session::IdleTestSession};
use mainframe_types::adapter::SessionResult;
use std::{sync::atomic::Ordering, time::Duration};

#[tokio::test]
async fn ambiguous_provider_timeout_stops_polling_and_preserves_fifo() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    session.ready.store(false, Ordering::SeqCst);
    manager
        .enqueue_maintenance_input("c", "first", None, None)
        .await
        .unwrap();
    manager
        .enqueue_maintenance_input("c", "second", None, None)
        .await
        .unwrap();
    let before = deps.idle_queue_list("c").unwrap();
    let result = manager
        .drain_maintenance_queue_with_wait("c", Duration::from_millis(1))
        .await;
    assert!(result.is_err());
    assert_eq!(
        serde_json::to_value(deps.idle_queue_list("c").unwrap()).unwrap(),
        serde_json::to_value(before).unwrap()
    );
    assert!(session.sent.lock_recover().is_empty());
    session.ready.store(true, Ordering::SeqCst);
    manager.resume_maintenance_queue("c").await.unwrap();
    manager.drain_maintenance_queue("c").await.unwrap();
    finish_turn(&session, false);
    manager.drain_maintenance_queue("c").await.unwrap();
    assert_eq!(
        session
            .sent
            .lock_recover()
            .iter()
            .map(|s| s.0.clone())
            .collect::<Vec<_>>(),
        ["first", "second"]
    );
    assert!(deps.idle_queue_list("c").unwrap().is_empty());
}

#[tokio::test]
async fn overlapping_drain_attempt_returns_without_polling_or_replaying() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    manager
        .enqueue_maintenance_input("c", "once", None, None)
        .await
        .unwrap();
    session.hold_send.store(true, Ordering::SeqCst);
    let worker = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.drain_maintenance_queue("c").await })
    };
    session.send_started.notified().await;
    tokio::time::timeout(
        Duration::from_millis(100),
        manager.drain_maintenance_queue("c"),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(session.sent.lock_recover().len(), 1);
    assert_eq!(
        deps.idle_queue_list("c").unwrap()[0].delivery,
        DeliveryState::Unconfirmed
    );
    worker.abort();
    let _ = worker.await;
    manager.drain_maintenance_queue("c").await.unwrap();
    assert_eq!(session.sent.lock_recover().len(), 1);
    assert_eq!(deps.idle_queue_list("c").unwrap().len(), 1);
}

pub(in crate::chat_manager) fn finish_turn(session: &IdleTestSession, failed: bool) {
    let sink = session.sink.lock_recover().as_ref().unwrap().clone();
    if session.adapter_id() == "codex" {
        use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
        handle_notification(
            "turn/completed",
            &serde_json::json!({"turn": {"id": "turn-1", "status": if failed { "failed" } else { "completed" }}}),
            &sink,
            &mut CodexSessionState::default(),
        );
        return;
    }
    sink.on_result(SessionResult {
        subtype: Some(
            if failed {
                "error_during_execution"
            } else {
                "success"
            }
            .into(),
        ),
        is_error: Some(failed),
        total_cost_usd: None,
        usage: None,
        result: None,
        context_tokens: None,
    });
}

#[tokio::test(flavor = "multi_thread")]
async fn claude_dispatches_one_edited_prompt_per_successful_result() {
    dispatches_one_prompt_per_result(IdleTestSession::new()).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn codex_dispatches_one_queued_prompt_per_successful_result() {
    dispatches_one_prompt_per_result(codex_session()).await;
}

fn codex_session() -> IdleTestSession {
    let mut session = IdleTestSession::new();
    session.inner.adapter = Some("codex".into());
    session
}

async fn dispatches_one_prompt_per_result(test_session: IdleTestSession) {
    let (manager, deps, session) = fixture(test_session).await;
    assert!(manager.shared.manager.set(Arc::downgrade(&manager)).is_ok());
    manager
        .send_message("c", "initial", None, None)
        .await
        .unwrap();
    let first = manager
        .send_message_with_queue_id("c", "first", None, None)
        .await
        .unwrap()
        .unwrap();
    let removed = manager
        .send_message_with_queue_id("c", "remove", None, None)
        .await
        .unwrap()
        .unwrap();
    let second = manager
        .send_message_with_queue_id("c", "second", None, None)
        .await
        .unwrap()
        .unwrap();
    manager
        .edit_queued_message("c", &first, "edited")
        .await
        .unwrap();
    assert!(manager.cancel_queued_message("c", &removed).await.unwrap());
    assert_eq!(session.sent.lock_recover().len(), 1);
    let queued = deps.idle_queue_list("c").unwrap();
    assert_eq!(queued.len(), 2);
    assert!(
        queued
            .iter()
            .all(|input| input.delivery == DeliveryState::Pending)
    );
    if session.adapter_id() == "codex" {
        manager.steer_message("c", "steer now").await.unwrap();
        assert_eq!(*session.steered.lock_recover(), ["steer now"]);
        assert_eq!(session.sent.lock_recover().len(), 1);
    }

    finish_turn(&session, false);
    wait_until_sent(&manager, &first).await;
    assert_eq!(session.sent.lock_recover().len(), 2);
    assert_eq!(session.sent.lock_recover()[1].0, "edited");
    assert_eq!(manager.get_queued_for_chat("c")[0].message_id, second);

    finish_turn(&session, false);
    wait_until_sent(&manager, &second).await;
    assert_eq!(session.sent.lock_recover()[2].0, "second");
    assert!(deps.idle_queue_list("c").unwrap().is_empty());
}

async fn wait_until_sent(manager: &ChatManager, id: &str) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while manager
            .get_queued_for_chat("c")
            .iter()
            .any(|r| r.message_id == id)
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn claude_keeps_pending_input_after_error_or_interrupt() {
    keeps_pending_input_after_failure(IdleTestSession::new).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn codex_keeps_pending_input_after_error_or_interrupt() {
    keeps_pending_input_after_failure(codex_session).await;
}

async fn keeps_pending_input_after_failure(test_session: fn() -> IdleTestSession) {
    for interrupted in [false, true] {
        let (manager, deps, session) = fixture(test_session()).await;
        assert!(manager.shared.manager.set(Arc::downgrade(&manager)).is_ok());
        manager
            .send_message("c", "initial", None, None)
            .await
            .unwrap();
        manager.send_message("c", "hold", None, None).await.unwrap();
        if interrupted {
            manager.interrupt_chat("c").await;
        }
        finish_turn(&session, !interrupted);
        tokio::task::yield_now().await;
        assert_eq!(session.sent.lock_recover().len(), 1);
        assert_eq!(
            deps.idle_queue_list("c").unwrap()[0].delivery,
            DeliveryState::Pending
        );
    }
}
