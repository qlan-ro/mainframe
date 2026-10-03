//! `RevisionRegistry` and the `FacadeHub` methods built on it (todo #377).
//! End-to-end hub-level cases (recording with nobody attached, epoch resets
//! from chat-surface events, registry eviction through a resume) live in
//! `hub/tests/revision_cursor_tests.rs`; these are the narrower
//! registry/method-level cases.

use mainframe_acp::encoder::delta::EncodedDelta;
use mainframe_acp::encoder::{EncodedItem, ItemRole};
use mainframe_types::acp::content::ContentBlock;

use super::*;

fn msg(id: &str, text: &str) -> EncodedItem {
    EncodedItem::Message {
        id: id.to_string(),
        role: ItemRole::Agent,
        content: vec![ContentBlock::Text {
            text: text.to_string(),
            meta: None,
        }],
        meta: None,
    }
}

fn hub() -> FacadeHub {
    FacadeHub::new(0)
}

/// A `full` `EncodedDelta` over one container holding `items` — the shape
/// `record_display_delta` expects, standing in for these tests' old flat
/// `record(items)` calls (todo #376 G4). `record_full`'s outcomes,
/// boundary bumps, and tombstones match `record`'s exactly for this shape;
/// `full`'s own fallback closure is never called for a `full` delta, so
/// every call site below hands it an unreachable stub.
fn full(items: Vec<EncodedItem>) -> EncodedDelta {
    EncodedDelta::full(vec![items])
}

#[test]
fn get_returns_none_for_a_chat_with_no_log() {
    let registry = RevisionRegistry::default();
    assert!(registry.get("chat-1").is_none());
}

#[test]
fn get_or_create_returns_the_same_log_on_a_second_call() {
    let registry = RevisionRegistry::default();
    let first = registry.get_or_create("chat-1");
    let second = registry.get_or_create("chat-1");
    assert!(Arc::ptr_eq(&first, &second));
}

#[test]
fn get_finds_a_log_get_or_create_made() {
    let registry = RevisionRegistry::default();
    let created = registry.get_or_create("chat-1");
    let found = registry.get("chat-1").expect("the log just created");
    assert!(Arc::ptr_eq(&created, &found));
}

#[test]
fn reset_epoch_on_an_unknown_chat_is_a_noop() {
    let registry = RevisionRegistry::default();
    registry.reset_epoch("chat-1");
    assert!(registry.get("chat-1").is_none());
}

#[test]
fn reset_epoch_replaces_the_log_with_a_fresh_one() {
    let registry = RevisionRegistry::default();
    let before = registry.get_or_create("chat-1");
    before.lock().unwrap().record(&[msg("m1", "hello")]);

    registry.reset_epoch("chat-1");
    let after = registry.get("chat-1").expect("still logged, new epoch");
    assert!(!Arc::ptr_eq(&before, &after));
    assert_ne!(
        before.lock().unwrap().boundary().epoch,
        after.lock().unwrap().boundary().epoch
    );
    assert_eq!(after.lock().unwrap().boundary().revision, 0);
}

#[test]
fn drop_chat_forgets_the_log_entirely() {
    let registry = RevisionRegistry::default();
    registry.get_or_create("chat-1");
    registry.drop_chat("chat-1");
    assert!(registry.get("chat-1").is_none());
}

#[test]
fn eviction_drops_the_least_recently_touched_chat() {
    let registry = RevisionRegistry::default();
    for i in 0..MAX_LOGGED_CHATS {
        registry.get_or_create(&format!("chat-{i}"));
    }
    // One more pushes the registry over its cap; "chat-0" is the oldest.
    registry.get_or_create("chat-new");
    assert!(
        registry.get("chat-0").is_none(),
        "the oldest chat was evicted"
    );
    assert!(registry.get("chat-new").is_some());
}

#[test]
fn touching_a_chat_protects_it_from_eviction() {
    let registry = RevisionRegistry::default();
    for i in 0..MAX_LOGGED_CHATS {
        registry.get_or_create(&format!("chat-{i}"));
    }
    // Touch "chat-0" so it is no longer the least-recently-touched entry.
    registry.get("chat-0");
    registry.get_or_create("chat-new");
    assert!(
        registry.get("chat-0").is_some(),
        "freshly touched, so chat-1 should have been evicted instead"
    );
    assert!(registry.get("chat-1").is_none());
}

#[test]
fn record_revision_on_a_chat_with_no_log_returns_none() {
    let hub = hub();
    assert!(
        hub.record_display_delta("chat-1", &full(vec![msg("m1", "hello")]), || unreachable!())
            .is_none()
    );
}

#[test]
fn record_revision_returns_the_new_boundary_on_a_change() {
    let hub = hub();
    hub.revisions.get_or_create("chat-1");
    let cursor = hub
        .record_display_delta("chat-1", &full(vec![msg("m1", "hello")]), || unreachable!())
        .expect("a new item is a recorded change");
    assert_eq!(cursor.revision, 1);
}

#[test]
fn record_revision_returns_none_for_an_identical_snapshot() {
    let hub = hub();
    hub.revisions.get_or_create("chat-1");
    hub.record_display_delta("chat-1", &full(vec![msg("m1", "hello")]), || unreachable!());
    assert!(
        hub.record_display_delta("chat-1", &full(vec![msg("m1", "hello")]), || unreachable!())
            .is_none()
    );
}

#[test]
fn a_vanished_tool_call_resets_the_epoch_instead_of_recording() {
    let hub = hub();
    let tool = EncodedItem::ToolCall {
        id: "t1".to_string(),
        title: "Read".to_string(),
        kind: mainframe_types::acp::tool_call::ToolKind::Read,
        status: mainframe_types::acp::tool_call::ToolCallStatus::Completed,
        raw_input: serde_json::Value::Null,
        content: Vec::new(),
        meta: None,
    };
    let log = hub.revisions.get_or_create("chat-1");
    let before_epoch = log.lock().unwrap().boundary().epoch;
    hub.record_display_delta("chat-1", &full(vec![tool]), || unreachable!());

    assert!(
        hub.record_display_delta("chat-1", &full(vec![]), || unreachable!())
            .is_none()
    );
    let after = hub.revisions.get("chat-1").expect("still logged");
    assert_ne!(after.lock().unwrap().boundary().epoch, before_epoch);
}

#[test]
fn has_revision_log_distinguishes_a_logged_chat_from_an_unlogged_one() {
    let hub = hub();
    assert!(!hub.has_revision_log("chat-1"));
    hub.revisions.get_or_create("chat-1");
    assert!(hub.has_revision_log("chat-1"));
}
