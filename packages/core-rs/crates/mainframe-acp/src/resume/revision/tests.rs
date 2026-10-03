//! `resolve`'s own cases (todo #377): what `dispatch_resume` delegates here
//! for a connection with a revision log. End-to-end cursor-meta-on-the-wire
//! cases live in `resume/tests.rs`, since those exercise `dispatch_resume`
//! itself; these are the narrower `resolve`-level cases that would be
//! awkward to drive through the full `ResumePort` plumbing.

use std::sync::Mutex;

use mainframe_types::acp::content::ContentBlock;
use mainframe_types::acp::extensions::RevisionCursor;
use serde_json::json;

use super::*;
use crate::encoder::ItemRole;

/// The boundary a caller like `hub.rs::begin_resume` would have captured
/// for `log` at this moment — these tests have no race to simulate, so the
/// captured boundary and `log`'s current one are the same value.
fn boundary_of(log: &Mutex<RevisionLog>) -> RevisionCursor {
    log.lock().unwrap().boundary()
}

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

/// These tests drive `resolve` directly with flat item fixtures; one item
/// per container is a faithful enough shape for cursor-resolution cases
/// that never inspect container boundaries.
fn containers_of(items: &[EncodedItem]) -> Vec<Vec<EncodedItem>> {
    items.iter().cloned().map(|item| vec![item]).collect()
}

#[test]
fn no_log_means_no_cursor_meta_at_all() {
    let items = [msg("m1", "hello")];
    let resolved = resolve(
        &items,
        &containers_of(&items),
        Some(&json!({ "type": "start" })),
        None,
    );
    assert!(resolved.cursor.is_none());
    assert!(!resolved.full_replay);
}

#[test]
fn a_legacy_cursor_on_an_opted_in_connection_still_gets_the_boundary() {
    let log = Mutex::new(RevisionLog::new("ep_1".to_string()));
    let items = [msg("m1", "hello")];
    let resolved = resolve(
        &items,
        &containers_of(&items),
        Some(&json!({ "type": "start" })),
        Some((&log, boundary_of(&log))),
    );
    assert_eq!(
        resolved.cursor,
        Some(RevisionCursor {
            epoch: "ep_1".to_string(),
            revision: 0
        })
    );
    assert!(
        !resolved.full_replay,
        "start always full-replays the items but is not the fullReplay fallback marker"
    );
}

#[test]
fn an_unseeded_log_is_seeded_from_the_snapshot() {
    let log = Mutex::new(RevisionLog::new("ep_1".to_string()));
    let items = [msg("m1", "hello")];
    resolve(
        &items,
        &containers_of(&items),
        None,
        Some((&log, boundary_of(&log))),
    );

    // A later revision cursor at revision 0 (the seed) sees no changes.
    let cursor = json!({ "type": "revision", "epoch": "ep_1", "revision": 0 });
    let resolved = resolve(
        &items,
        &containers_of(&items),
        Some(&cursor),
        Some((&log, boundary_of(&log))),
    );
    assert!(resolved.updates.is_empty());
    assert!(!resolved.full_replay);
}

#[test]
fn a_revision_cursor_within_the_boundary_is_incremental() {
    let log = Mutex::new(RevisionLog::new("ep_1".to_string()));
    {
        let mut locked = log.lock().unwrap();
        locked.record(&[msg("m1", "hello")]);
    }
    let cursor = json!({ "type": "revision", "epoch": "ep_1", "revision": 1 });
    let items = [msg("m1", "hello"), msg("m2", "world")];
    let resolved = resolve(
        &items,
        &containers_of(&items),
        Some(&cursor),
        Some((&log, boundary_of(&log))),
    );
    assert!(!resolved.full_replay);
    assert_eq!(
        resolved.updates.len(),
        1,
        "only the new item: {:?}",
        resolved.updates
    );
}

#[test]
fn an_unknown_epoch_falls_back_to_a_full_replay_with_the_new_cursor() {
    let log = Mutex::new(RevisionLog::new("ep_1".to_string()));
    {
        let mut locked = log.lock().unwrap();
        locked.record(&[msg("m1", "hello")]);
    }
    let cursor = json!({ "type": "revision", "epoch": "ep_stale", "revision": 1 });
    let items = [msg("m1", "hello")];
    let resolved = resolve(
        &items,
        &containers_of(&items),
        Some(&cursor),
        Some((&log, boundary_of(&log))),
    );
    assert!(resolved.full_replay);
    assert_eq!(
        resolved.cursor,
        Some(RevisionCursor {
            epoch: "ep_1".to_string(),
            revision: 1
        })
    );
    assert_eq!(
        resolved.updates.len(),
        1,
        "a full replay still creates every item"
    );
}
