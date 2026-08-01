//! Wiring-level regression coverage for #289: the daemon's production
//! `ChatManagerDeps` (`DaemonChatDeps`, assembled by `build_chat_manager`) must
//! delegate `is_transcript_present` to the registry-resolved adapter, and the
//! external-session sweep's `reconcile_transcript` callback must reach
//! `ChatManager::reconcile_transcript`. Unlike `mainframe-chat`'s
//! `transcript_presence` unit tests — which call the reconciliation function
//! directly against a hand-built `TranscriptPresenceDeps` fake — these tests
//! drive the production stack end to end: a real adapter registered under
//! `AdapterRegistry`, read back only through `ChatManager`'s public history and
//! sweep APIs. A regression where `DaemonChatDeps` silently inherited the trait
//! default (`Box::pin(async { None })`) would fail every case here.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod transcript_presence_support;

use std::sync::atomic::Ordering;
use std::time::Duration;

use transcript_presence_support::{PredicateOutcome, StubAdapter, harness, persisted_missing};

#[tokio::test]
async fn absent_transcript_flips_the_persisted_flag_and_broadcasts() {
    let adapter = StubAdapter::new("stub-adapter", PredicateOutcome::Absent);
    let h = harness(Some(adapter), None);
    let mut rx = h.broadcast.subscribe();

    let payload = h.manager.get_display_messages(&h.chat_id).await;

    assert!(payload.transcript_missing);
    assert_eq!(persisted_missing(&h), Some(true));

    let chat = transcript_presence_support::next_chat_updated(&mut rx, Duration::from_secs(5))
        .await
        .expect("chat.updated within 5s");
    assert_eq!(chat.transcript_missing, Some(true));
}

#[tokio::test]
async fn present_transcript_clears_a_stale_flag() {
    let adapter = StubAdapter::new("stub-adapter", PredicateOutcome::Present);
    let h = harness(Some(adapter), Some(true));
    let mut rx = h.broadcast.subscribe();

    let payload = h.manager.get_display_messages(&h.chat_id).await;

    assert!(!payload.transcript_missing);
    assert_eq!(persisted_missing(&h), Some(false));

    let chat = transcript_presence_support::next_chat_updated(&mut rx, Duration::from_secs(5))
        .await
        .expect("chat.updated within 5s");
    assert_eq!(chat.transcript_missing, Some(false));
}

#[tokio::test]
async fn an_unregistered_adapter_id_leaves_the_flag_unchanged() {
    let h = harness(None, Some(true));
    let mut rx = h.broadcast.subscribe();

    let payload = h.manager.get_display_messages(&h.chat_id).await;

    assert!(payload.transcript_missing);
    assert_eq!(persisted_missing(&h), Some(true));

    let chat =
        transcript_presence_support::next_chat_updated(&mut rx, Duration::from_millis(200)).await;
    assert!(
        chat.is_none(),
        "an unresolvable adapter id must not broadcast chat.updated"
    );
}

#[tokio::test]
async fn a_failing_predicate_leaves_the_flag_unchanged() {
    let adapter = StubAdapter::new("stub-adapter", PredicateOutcome::Error);
    let h = harness(Some(adapter.clone()), Some(true));
    let mut rx = h.broadcast.subscribe();

    let payload = h.manager.get_display_messages(&h.chat_id).await;

    assert!(payload.transcript_missing);
    assert_eq!(persisted_missing(&h), Some(true));
    assert_eq!(
        adapter.calls.load(Ordering::SeqCst),
        1,
        "an errored predicate must still have been consulted"
    );

    let chat =
        transcript_presence_support::next_chat_updated(&mut rx, Duration::from_millis(200)).await;
    assert!(
        chat.is_none(),
        "a failing predicate must not broadcast chat.updated"
    );
}

#[tokio::test]
async fn the_external_session_sweep_reconciles_an_unopened_chat() {
    let adapter = StubAdapter::new("stub-adapter", PredicateOutcome::Absent);
    let h = harness(Some(adapter), None);
    let service = h
        .manager
        .external_session_service()
        .expect("external session service wired");

    service.start_auto_scan(&h.project_id);

    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        if persisted_missing(&h) == Some(true) {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "sweep never flipped transcript_missing within 5s"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }

    service.stop_auto_scan(&h.project_id);
    assert_eq!(persisted_missing(&h), Some(true));
}
