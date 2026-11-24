//! What a steer waits for before it may join a turn (`chat_manager/steer.rs`).
//! A child module of `tests`, so it sees its fakes.

use super::*;

/// Stop is ending the CLI's process: a steer waits for that, then has no turn to join.
#[tokio::test]
async fn steer_waits_for_an_interrupt_and_joins_nothing_after_it() {
    let mgr = ChatManager::new(FakeDeps::arc());
    let session = RecSession::new("c1", true, true);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );
    mgr.interrupt_chat("c1").await;

    let steer = mgr.steer_message("c1", "x");
    tokio::pin!(steer);
    let waited = tokio::time::timeout(std::time::Duration::from_millis(100), &mut steer).await;
    assert!(waited.is_err(), "the interrupt is still running");
    assert!(session.steer_calls.lock().unwrap().is_empty());

    session
        .exited
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let err = steer.await.unwrap_err();
    assert!(err.never_delivered(), "the caller may queue it instead");
    assert!(session.steer_calls.lock().unwrap().is_empty());
}

/// An offload in flight is about to kill the session a steer would write to.
#[tokio::test]
async fn steer_waits_for_an_offload_like_any_other_send() {
    let mgr = ChatManager::new(FakeDeps::arc());
    let session = RecSession::new("c1", true, true);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );
    let offload = mgr.lifecycle.try_claim_offload("c1").unwrap();

    let steer = mgr.steer_message("c1", "x");
    tokio::pin!(steer);
    let waited = tokio::time::timeout(std::time::Duration::from_millis(100), &mut steer).await;
    assert!(waited.is_err(), "the offload is still running");
    assert!(session.steer_calls.lock().unwrap().is_empty());

    drop(offload);
    steer.await.unwrap();
    assert_eq!(session.steer_calls.lock().unwrap().len(), 1);
}
