use super::*;
use crate::chat_manager::{idle_compaction_tests::fixture, idle_test_session::IdleTestSession};
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
    manager.drain_maintenance_queue("c").await.unwrap();
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
