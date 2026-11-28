//! Transcript integrity across a release: one restore path, no install over a
//! newer write, and no silent drop when the history cannot come back.

use super::*;
use tokio::sync::Notify;

/// A released "c1" whose history reads go through a session the test gates.
async fn released_with_gate(history: Vec<ChatMessage>) -> (Fixture, Arc<(Notify, Notify)>) {
    let f = fixture();
    scan(&f.mgr).await;
    assert!(f.mgr.shared.messages.lock().unwrap().is_released("c1"));
    let gate = Arc::new((Notify::new(), Notify::new()));
    f.deps.set_session_to_return(Arc::new(FakeSession {
        history,
        history_gate: Some(gate.clone()),
        spawn_ok: true,
        history_loads: Some(f.deps.adapters.history_loads.clone()),
        ..Default::default()
    }));
    (f, gate)
}

#[tokio::test]
async fn a_history_read_and_a_send_share_one_restore_and_keep_the_prompt() {
    let (f, gate) = released_with_gate(vec![message("m1"), message("m2")]).await;
    let loads = f.deps.adapters.history_loads.clone();
    let before = loads.load(std::sync::atomic::Ordering::SeqCst);
    let mgr = Arc::new(f.mgr);

    let reader = tokio::spawn({
        let mgr = mgr.clone();
        async move { mgr.get_messages("c1").await }
    });
    gate.0.notified().await;
    let sender = tokio::spawn({
        let mgr = mgr.clone();
        async move { mgr.send_message("c1", "prompt", None, None).await }
    });
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    // Open the gate until both finish: a second read, if any, waits on it too.
    while !(reader.is_finished() && sender.is_finished()) {
        gate.1.notify_one();
        tokio::task::yield_now().await;
    }
    reader.await.unwrap();
    sender.await.unwrap().expect("the send delivers");

    let ids = cached_ids(&mgr);
    assert_eq!(
        ids.len(),
        3,
        "the restored history, then the prompt: {ids:?}"
    );
    assert_eq!(&ids[..2], ["m1", "m2"]);
    assert_eq!(
        loads.load(std::sync::atomic::Ordering::SeqCst) - before,
        1,
        "the read and the send shared one restore"
    );
}

#[tokio::test]
async fn a_send_stops_with_a_retryable_error_when_the_history_cannot_come_back() {
    let f = fixture();
    scan(&f.mgr).await;
    *f.deps.adapters.history.lock().unwrap() = None;

    let err = f
        .mgr
        .send_message("c1", "prompt", None, None)
        .await
        .expect_err("a prompt is never dropped silently");

    assert!(err.never_delivered(), "the user can send it again: {err}");
    assert!(err.to_string().contains("Try again"));
    assert!(f.mgr.shared.messages.lock().unwrap().is_released("c1"));
}

#[tokio::test]
async fn an_empty_history_read_successfully_ends_the_release() {
    let f = fixture();
    scan(&f.mgr).await;
    *f.deps.adapters.history.lock().unwrap() = Some(Vec::new());

    f.mgr
        .send_message("c1", "prompt", None, None)
        .await
        .expect("an empty transcript is still a history");

    assert!(!f.mgr.shared.messages.lock().unwrap().is_released("c1"));
    assert_eq!(cached_ids(&f.mgr).len(), 1, "the prompt is kept");
}

#[tokio::test]
async fn the_hub_hears_of_a_release_before_any_resume_can_read() {
    let f = fixture();
    assert!(f.surface.probe.set(f.mgr.lifecycle.clone()).is_ok());
    scan(&f.mgr).await;

    let offloaded = fixture_with(IDLE_THRESHOLD_MS + 5 * MINUTE, |_| {});
    assert!(
        offloaded
            .surface
            .probe
            .set(offloaded.mgr.lifecycle.clone())
            .is_ok()
    );
    offloaded.mgr.scan_idle_sessions().await;

    for surface in [&f.surface, &offloaded.surface] {
        assert_eq!(
            *surface.claim_free_at_notice.lock().unwrap(),
            [false],
            "the notice arrives while the release still holds the claim"
        );
    }
}

#[tokio::test]
async fn a_cached_history_read_counts_as_use() {
    let f = fixture();
    let stale = f.mgr.last_used_at("c1").unwrap();

    f.mgr.get_messages("c1").await;
    let after_read = f.mgr.last_used_at("c1").unwrap();
    assert!(after_read > stale, "get_messages from memory");

    f.mgr
        .shared
        .active("c1")
        .unwrap()
        .lock()
        .unwrap()
        .last_used_at = stale;
    f.mgr.get_resume_snapshot("c1").await;
    assert!(
        f.mgr.last_used_at("c1").unwrap() > stale,
        "a resume answered from memory"
    );
}
