//! A restore installs a history only when every transcript it needs read:
//! otherwise the chat stays released, nothing reads it in its place, and no
//! process starts. Also the activity check at the moment of clearing.

use super::rules::releaser;
use super::*;
use crate::idle_scanner::HistoryReleaser as _;
use crate::lifecycle_manager::release::HistoryRead;

/// A released "c1" whose history reads come through `session`.
pub(super) async fn released_reading_through(session: FakeSession) -> (Fixture, Arc<FakeSession>) {
    let f = fixture();
    scan(&f.mgr).await;
    assert!(f.mgr.shared.messages.lock().unwrap().is_released("c1"));
    let session = Arc::new(session);
    f.deps.set_session_to_return(session.clone());
    (f, session)
}

pub(super) fn started(f: &Fixture) -> bool {
    f.deps
        .events()
        .iter()
        .any(|e| matches!(e, DaemonEvent::ProcessStarted { .. }))
}

/// Codex reports a failed app-server start or history read as an empty list;
/// the restore must not take that for the chat's history.
#[tokio::test]
async fn a_read_reported_as_failed_keeps_the_chat_released_for_every_caller() {
    let loads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let (f, _) = released_reading_through(FakeSession {
        history: vec![message("m1"), message("m2")],
        history_read_failed: true,
        history_loads: Some(loads.clone()),
        spawn_ok: true,
        ..Default::default()
    })
    .await;
    let reads = || loads.load(std::sync::atomic::Ordering::SeqCst);

    let read = f.mgr.get_messages("c1").await;
    assert!(read.is_empty(), "nothing read in its place");
    assert_eq!(reads(), 1, "one failed restore ends the read");
    let err = f.mgr.send_message("c1", "prompt", None, None).await;
    assert!(err.is_err_and(|e| e.never_delivered()));
    assert!(f.mgr.shared.messages.lock().unwrap().is_released("c1"));
    assert!(!holds_history(&f.mgr));
}

#[tokio::test]
async fn no_process_starts_before_the_history_is_back() {
    let (f, failing) = released_reading_through(FakeSession {
        history: vec![message("m1"), message("m2")],
        history_read_failed: true,
        spawn_ok: true,
        ..Default::default()
    })
    .await;
    f.mgr.lifecycle.start_chat("c1").await;
    assert!(!started(&f), "a failed restore starts nothing");
    assert!(failing.spawn_options.lock().unwrap().is_none());

    let (f, readable) = released_reading_through(FakeSession {
        history: vec![message("m1"), message("m2")],
        spawn_ok: true,
        ..Default::default()
    })
    .await;
    f.mgr.lifecycle.start_chat("c1").await;
    assert!(started(&f));
    assert!(readable.spawn_options.lock().unwrap().is_some());
    assert_eq!(
        cached_ids(&f.mgr),
        ["m1", "m2"],
        "restored before the start"
    );
}

pub(super) fn two_segment_layout() -> mainframe_types::segment::SegmentLayout {
    use crate::chat_manager::tests::segment_fake::{native, segment};
    use mainframe_types::segment::{SegmentKind, SegmentLayout};
    let mut layout = SegmentLayout {
        segments: vec![
            segment("s0", 0, "ns_c", SegmentKind::Initial),
            segment("s1", 1, "ns_x", SegmentKind::ProviderSwitch),
        ],
        natives: vec![
            native("ns_c", "claude", Some("c-1")),
            native("ns_x", "codex", Some("x-1")),
        ],
        handoffs: vec![],
    };
    layout.segments[1].closed_at = None;
    layout
}

pub(super) fn failing_reads() -> Arc<FakeSession> {
    Arc::new(FakeSession {
        history: vec![message("m1")],
        history_read_failed: true,
        ..Default::default()
    })
}

#[tokio::test]
async fn a_segment_that_fails_to_read_keeps_a_composed_chat_released() {
    use crate::chat_manager::tests::segment_fake::FakeStore;
    let f = fixture();
    f.deps
        .set_segment_store(FakeStore::with_layout(two_segment_layout()));
    std::fs::create_dir_all("/tmp/test").expect("create the fake project dir");
    scan(&f.mgr).await;
    assert!(f.mgr.shared.messages.lock().unwrap().is_released("c1"));
    f.deps.set_session_to_return(failing_reads());

    f.mgr.lifecycle.load_chat("c1").await;

    assert!(f.mgr.shared.messages.lock().unwrap().is_released("c1"));
    assert!(!holds_history(&f.mgr), "no history with a segment missing");
}

/// A composed history that loaded with a segment missing cannot be read back
/// whole, so it is never released in the first place.
#[tokio::test]
async fn a_composed_history_loaded_with_a_segment_missing_is_never_released() {
    use crate::chat_manager::tests::segment_fake::FakeStore;
    let f = fixture();
    f.deps
        .set_segment_store(FakeStore::with_layout(two_segment_layout()));
    std::fs::create_dir_all("/tmp/test").expect("create the fake project dir");
    f.deps.set_session_to_return(failing_reads());
    f.mgr
        .teardown
        .clear("c1", crate::chat_teardown::TeardownMode::Offload);
    f.mgr.lifecycle.load_chat("c1").await;
    assert!(f.mgr.shared.messages.lock().unwrap().is_partial("c1"));
    assert!(holds_history(&f.mgr), "what did load is in memory");
    f.mgr
        .set_last_used_at_for_test("c1", now_ms() - 60 * MINUTE);

    scan(&f.mgr).await;

    assert!(
        !f.mgr.shared.messages.lock().unwrap().is_released("c1"),
        "the partial history stays in memory"
    );
}

#[tokio::test]
async fn the_history_claim_sends_a_released_chat_back_to_the_shared_restore() {
    let f = fixture();
    assert!(matches!(
        f.mgr.lifecycle.claim_history_read("c1").await,
        HistoryRead::Lead(_)
    ));
    scan(&f.mgr).await;

    assert!(matches!(
        f.mgr.lifecycle.claim_history_read("c1").await,
        HistoryRead::Released
    ));
}

/// The release reads the chat's state, then asks who is viewing it. A view
/// that starts and ends between the two leaves no viewer and an old clock in
/// that state, so only the activity check at the clear can see it.
#[tokio::test]
async fn a_view_that_falls_entirely_between_the_release_checks_keeps_the_history() {
    let f = fixture();
    let lifecycle = f.mgr.lifecycle.clone();
    *f.viewers.1.lock().unwrap() = Some(Box::new(move || lifecycle.touch("c1")));

    releaser(&f.mgr).release("c1", now_ms() - 10 * MINUTE).await;

    assert!(holds_history(&f.mgr));
    releaser(&f.mgr).release("c1", now_ms() + MINUTE).await;
    assert!(
        !holds_history(&f.mgr),
        "with no use since, the next pass releases it"
    );
}
