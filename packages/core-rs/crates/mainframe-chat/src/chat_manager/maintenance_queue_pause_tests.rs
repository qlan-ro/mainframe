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
