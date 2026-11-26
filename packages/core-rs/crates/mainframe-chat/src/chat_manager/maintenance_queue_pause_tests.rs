use super::super::idle_compaction_tests::fixture;
use super::super::idle_test_session::IdleTestSession;
use super::super::maintenance_queue::wait_tests::finish_turn;
use super::*;
use mainframe_types::sync::LockExt as _;

#[tokio::test]
async fn stop_during_maintenance_holds_queue_until_explicit_resume() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    let maintenance = manager.lifecycle.try_claim_maintenance("c").unwrap();
    manager
        .enqueue_maintenance_input("c", "held", None, None)
        .await
        .unwrap();
    manager.interrupt_chat("c").await;
    drop(maintenance);
    manager.drain_maintenance_queue("c").await.unwrap();
    assert!(session.sent.lock_recover().is_empty());
    assert_eq!(
        manager.get_queued_for_chat("c")[0].pause_reason.as_deref(),
        Some("Stopped")
    );
    manager
        .send_message("c", "new turn", None, None)
        .await
        .unwrap();
    finish_turn(&session, false);
    manager.drain_maintenance_queue("c").await.unwrap();
    assert_eq!(session.sent.lock_recover()[0].0, "new turn");
    assert_eq!(deps.idle_queue_list("c").unwrap().len(), 1);
    manager.resume_maintenance_queue("c").await.unwrap();
    manager.drain_maintenance_queue("c").await.unwrap();
    assert_eq!(session.sent.lock_recover()[1].0, "held");
    assert!(deps.idle_queue_list("c").unwrap().is_empty());
}

#[tokio::test]
async fn waiting_drain_observes_stop_before_dispatch() {
    let (manager, _, session) = fixture(IdleTestSession::new()).await;
    manager
        .enqueue_maintenance_input("c", "held", None, None)
        .await
        .unwrap();
    let lock = manager.handoff_locks.acquire("maintenance:c").await;
    let drain = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.drain_maintenance_queue("c").await })
    };
    tokio::task::yield_now().await;
    manager.interrupt_chat("c").await;
    drop(lock);
    drain.await.unwrap().unwrap();
    assert!(session.sent.lock_recover().is_empty());
    assert_eq!(manager.get_queued_for_chat("c").len(), 1);
}

#[tokio::test]
async fn stop_wins_when_dispatch_waits_for_queue_control() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    manager
        .enqueue_maintenance_input("c", "held", None, None)
        .await
        .unwrap();
    let lock = manager.handoff_locks.acquire("queue-control:c").await;
    let mut stop = std::pin::pin!(manager.interrupt_chat("c"));
    let mut drain = std::pin::pin!(manager.drain_maintenance_queue("c"));
    std::future::poll_fn(|cx| {
        assert!(stop.as_mut().poll(cx).is_pending());
        assert!(drain.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    drop(lock);
    let (_, result) = tokio::join!(stop, drain);
    result.unwrap();
    assert!(session.sent.lock_recover().is_empty());
    assert!(
        deps.idle_queue_list("c").unwrap()[0]
            .delivery
            .ready_to_dispatch()
    );
}

#[tokio::test]
async fn resume_keeps_pause_for_a_rejected_head() {
    let (manager, _, session) = fixture(IdleTestSession::new()).await;
    let first = manager
        .enqueue_maintenance_input("c", "first", None, None)
        .await
        .unwrap();
    *session.send_failure.lock_recover() = Some(AdapterError::StdinFull("test".into()));
    assert!(manager.drain_maintenance_queue("c").await.is_err());
    manager.shared.pause_maintenance_queue("c", "Stopped");
    manager.resume_maintenance_queue("c").await.unwrap();
    assert_eq!(
        manager.get_queued_for_chat("c")[0].pause_reason.as_deref(),
        Some("Stopped")
    );
    manager
        .edit_queued_message("c", &first, "first")
        .await
        .unwrap();
    manager.resume_maintenance_queue("c").await.unwrap();
    manager.drain_maintenance_queue("c").await.unwrap();
    assert_eq!(session.sent.lock_recover().len(), 2);
}

#[tokio::test]
async fn resume_keeps_its_control_until_the_provider_is_ready() {
    use std::sync::atomic::Ordering;
    let (manager, _, session) = fixture(IdleTestSession::new()).await;
    manager
        .enqueue_maintenance_input("c", "held", None, None)
        .await
        .unwrap();
    manager.shared.pause_maintenance_queue("c", "Stopped");
    session.ready.store(false, Ordering::SeqCst);
    assert!(manager.resume_maintenance_queue("c").await.is_err());
    assert_eq!(
        manager.get_queued_for_chat("c")[0].pause_reason.as_deref(),
        Some("Stopped")
    );
    session.ready.store(true, Ordering::SeqCst);
    manager.resume_maintenance_queue("c").await.unwrap();
    manager.drain_maintenance_queue("c").await.unwrap();
    assert!(manager.get_queued_for_chat("c").is_empty());
}

#[tokio::test(start_paused = true)]
async fn stop_returns_while_codex_turn_start_reply_is_pending() {
    use std::time::Duration;

    let mut fake = IdleTestSession::new();
    fake.inner.adapter = Some("codex".into());
    fake.send_timeout = Some(Duration::from_secs(30));
    let (manager, deps, session) = fixture(fake).await;
    for message in ["first", "second"] {
        manager
            .enqueue_maintenance_input("c", message, None, None)
            .await
            .unwrap();
    }
    let drain = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.drain_maintenance_queue("c").await })
    };
    session.send_started.notified().await;
    tokio::time::timeout(Duration::from_millis(100), manager.interrupt_chat("c"))
        .await
        .expect("Stop must return before the turn/start timeout");
    assert!(!drain.is_finished());
    assert_eq!(
        manager.get_queued_for_chat("c")[1].pause_reason.as_deref(),
        Some("Stopped")
    );
    assert!(drain.await.unwrap().is_err());
    assert_eq!(
        manager.get_queued_for_chat("c")[0].delivery.as_deref(),
        Some("unconfirmed")
    );
    manager.drain_maintenance_queue("c").await.unwrap();
    assert_eq!(session.sent.lock_recover().len(), 1);
    assert!(
        deps.idle_queue_list("c").unwrap()[1]
            .delivery
            .ready_to_dispatch()
    );
}
