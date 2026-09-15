//! Session-teardown and retry-ordering cases for the partial-message
//! overlay — a superseded session's overlay dropping cleanly, the retry
//! notification preceding its own clearing revision, and a dangling
//! partial clearing on result/exit — split out of `tests.rs` (todo #350,
//! plan task 37, R2.13).

use super::*;
use crate::chat_surface::ChatSurfaceEvent;

#[test]
fn a_superseded_sessions_overlay_is_dropped() {
    let deps = Arc::new(OverlayDeps::default());
    let handler = EventHandler::new(
        Arc::new(Mutex::new(MessageCache::new())),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps,
    );
    let surface = Arc::new(RevisionSurface::default());
    handler.set_chat_surface(surface.clone());

    let sink_s1 = handler.build_sink("chat-partial", Some("s1".to_string()));
    let sink_s2 = handler.build_sink("chat-partial", Some("s2".to_string()));

    sink_s1.on_message_partial("msg_1", vec![text("s1 partial")]);
    assert_eq!(surface.revisions().len(), 1);

    // s2 never wrote an overlay of its own — its exit must not touch s1's.
    sink_s2.on_exit(None);
    let revisions = surface.revisions();
    assert_eq!(
        revisions.len(),
        1,
        "s2's exit must not re-emit — it owns no overlay for this chat: {revisions:?}"
    );
    assert_eq!(first_text(&revisions[0][0]), "s1 partial");

    sink_s1.on_exit(None);
    let revisions = surface.revisions();
    assert_eq!(revisions.len(), 2);
    assert!(
        revisions[1].is_empty(),
        "s1's own exit must clear its own overlay: {revisions:?}"
    );
}

#[test]
fn retry_precedes_its_clearing_revision() {
    let deps = Arc::new(OverlayDeps::default());
    let handler = EventHandler::new(
        Arc::new(Mutex::new(MessageCache::new())),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps,
    );
    let surface = Arc::new(OrderSurface::default());
    handler.set_chat_surface(surface.clone());
    let sink = handler.build_sink("chat-partial", None);

    sink.on_message_partial("msg_1", vec![text("interrupted")]);
    let before = surface.events().len();

    sink.on_api_retry(1, Some("overloaded".to_string()));

    let new_events = &surface.events()[before..];
    assert_eq!(
        new_events.len(),
        2,
        "expected the retry notification then its clearing revision: {new_events:?}"
    );
    assert!(
        matches!(&new_events[0], ChatSurfaceEvent::Retry { attempt: 1, .. }),
        "expected Retry first, got {:?}",
        new_events[0]
    );
    assert!(
        matches!(&new_events[1], ChatSurfaceEvent::DisplayRevision { .. }),
        "expected the clearing DisplayRevision second, got {:?}",
        new_events[1]
    );
}

#[test]
fn result_and_exit_clear_a_dangling_partial() {
    let (sink, _deps, surface) = setup();
    sink.on_message_partial("msg_1", vec![text("interrupted")]);
    sink.on_result(SessionResult {
        total_cost_usd: None,
        usage: None,
        context_tokens: None,
        subtype: None,
        result: None,
        is_error: None,
    });
    assert!(
        surface.revisions().last().is_some_and(Vec::is_empty),
        "an interrupted turn must not leave partial text behind"
    );
}
