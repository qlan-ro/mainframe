//! `RevisionLog::record` and `::plan` (todo #377). `msg`/`tool` builders
//! mirror `session_state/vanish_tests.rs`'s pattern: small, duplicated
//! fixtures rather than a shared helper module.

use mainframe_types::acp::content::ContentBlock;
use mainframe_types::acp::tool_call::{ToolCallContent, ToolCallStatus, ToolKind};
use mainframe_types::acp::update::SessionUpdate;
use serde_json::Value;

use super::*;
use crate::encoder::ItemRole;

fn text_block(text: &str) -> ContentBlock {
    ContentBlock::Text {
        text: text.to_string(),
        meta: None,
    }
}

fn msg(id: &str, text: &str) -> EncodedItem {
    EncodedItem::Message {
        id: id.to_string(),
        role: ItemRole::Agent,
        content: vec![text_block(text)],
        meta: None,
    }
}

fn msg_meta(id: &str, text: &str, meta: Value) -> EncodedItem {
    EncodedItem::Message {
        id: id.to_string(),
        role: ItemRole::Agent,
        content: vec![text_block(text)],
        meta: Some(meta),
    }
}

fn tool(id: &str) -> EncodedItem {
    EncodedItem::ToolCall {
        id: id.to_string(),
        title: "Read".to_string(),
        kind: ToolKind::Read,
        status: ToolCallStatus::Completed,
        raw_input: Value::Null,
        content: vec![ToolCallContent::Content {
            content: ContentBlock::Text {
                text: "ok".to_string(),
                meta: None,
            },
        }],
        meta: None,
    }
}

fn log() -> RevisionLog {
    RevisionLog::new("ep_1".to_string())
}

#[test]
fn a_new_item_bumps_exactly_once() {
    let mut log = log();
    assert_eq!(
        log.record(&[msg("m1", "hello")]),
        RecordOutcome::Recorded(1)
    );
    assert_eq!(log.boundary().revision, 1);
}

fn is_recorded(outcome: RecordOutcome) -> bool {
    matches!(outcome, RecordOutcome::Recorded(_))
}

#[test]
fn an_edit_bumps_exactly_once() {
    let mut log = log();
    assert!(is_recorded(log.record(&[msg("m1", "hello")])));
    assert_eq!(
        log.record(&[msg("m1", "hello world")]),
        RecordOutcome::Recorded(2)
    );
}

#[test]
fn a_meta_only_change_bumps_exactly_once() {
    let mut log = log();
    assert!(is_recorded(log.record(&[msg("m1", "hello")])));
    let revised = msg_meta("m1", "hello", serde_json::json!({ "durationMs": 42 }));
    assert_eq!(log.record(&[revised]), RecordOutcome::Recorded(2));
}

#[test]
fn an_identical_record_does_not_bump() {
    let mut log = log();
    assert!(is_recorded(log.record(&[msg("m1", "hello")])));
    assert_eq!(log.record(&[msg("m1", "hello")]), RecordOutcome::Unchanged);
    assert_eq!(log.boundary().revision, 1);
}

#[test]
fn a_vanished_message_is_tombstoned_and_bumps() {
    let mut log = log();
    assert!(is_recorded(log.record(&[msg("m1", "hello")])));
    assert_eq!(log.record(&[]), RecordOutcome::Recorded(2));
}

#[test]
fn a_vanished_tool_call_signals_an_epoch_reset() {
    let mut log = log();
    assert!(is_recorded(log.record(&[tool("t1")])));
    assert_eq!(log.record(&[]), RecordOutcome::ToolCallVanished);
}

#[test]
fn tombstone_overflow_raises_the_floor() {
    let mut log = log();
    // Create and then vanish MAX_TOMBSTONES + 1 distinct messages so the
    // oldest tombstone is evicted.
    for i in 0..=MAX_TOMBSTONES {
        let id = format!("m{i}");
        assert!(is_recorded(log.record(&[msg(&id, "hi")])));
        assert!(is_recorded(log.record(&[])));
    }
    assert!(
        log.floor > 0,
        "the oldest tombstone's revision raised the floor"
    );
}

fn plan_updates(plan: ReplayPlan) -> Vec<SessionUpdate> {
    match plan {
        ReplayPlan::Incremental(updates) => updates,
        ReplayPlan::Full => panic!("expected an incremental plan"),
    }
}

#[test]
fn a_pre_cursor_item_mutation_is_replayed_as_a_create() {
    let mut log = log();
    log.record(&[msg("m1", "hello")]);
    let cursor = log.boundary();
    log.record(&[msg("m1", "hello world")]);

    let updates = plan_updates(log.plan(&cursor, &[msg("m1", "hello world")]));
    assert_eq!(updates.len(), 1);
    assert!(matches!(updates[0], SessionUpdate::AgentMessage(_)));
}

#[test]
fn a_meta_only_change_past_the_cursor_is_replayed() {
    let mut log = log();
    log.record(&[msg("m1", "hello")]);
    let cursor = log.boundary();
    let revised = msg_meta("m1", "hello", serde_json::json!({ "durationMs": 42 }));
    log.record(std::slice::from_ref(&revised));

    let updates = plan_updates(log.plan(&cursor, &[revised]));
    assert_eq!(updates.len(), 1);
    assert!(matches!(updates[0], SessionUpdate::AgentMessage(_)));
}

#[test]
fn a_deletion_past_the_cursor_is_replayed_as_a_clear() {
    let mut log = log();
    log.record(&[msg("m1", "hello"), msg("m2", "world")]);
    let cursor = log.boundary();
    log.record(&[msg("m1", "hello")]);

    let updates = plan_updates(log.plan(&cursor, &[msg("m1", "hello")]));
    assert_eq!(updates.len(), 1);
    assert!(matches!(updates[0], SessionUpdate::AgentMessage(ref u) if u.message_id == "m2"));
}

#[test]
fn an_unchanged_item_does_not_appear_in_the_plan() {
    let mut log = log();
    log.record(&[msg("m1", "hello")]);
    let cursor = log.boundary();
    let updates = plan_updates(log.plan(&cursor, &[msg("m1", "hello")]));
    assert!(updates.is_empty());
}

#[test]
fn a_wrong_epoch_cursor_gives_full() {
    let mut log = log();
    log.record(&[msg("m1", "hello")]);
    let wrong = RevisionCursor {
        epoch: "ep_other".to_string(),
        revision: 1,
    };
    assert_eq!(log.plan(&wrong, &[msg("m1", "hello")]), ReplayPlan::Full);
}

#[test]
fn a_cursor_below_the_floor_gives_full() {
    let mut log = log();
    for i in 0..=MAX_TOMBSTONES {
        let id = format!("m{i}");
        log.record(&[msg(&id, "hi")]);
        log.record(&[]);
    }
    let stale = RevisionCursor {
        epoch: log.boundary().epoch,
        revision: 0,
    };
    assert_eq!(log.plan(&stale, &[]), ReplayPlan::Full);
}

#[test]
fn a_cursor_ahead_of_current_gives_full() {
    let mut log = log();
    log.record(&[msg("m1", "hello")]);
    let ahead = RevisionCursor {
        epoch: log.boundary().epoch,
        revision: 999,
    };
    assert_eq!(log.plan(&ahead, &[msg("m1", "hello")]), ReplayPlan::Full);
}

#[test]
fn a_newer_snapshot_item_is_replayed() {
    let mut log = log();
    log.record(&[msg("m1", "hello")]);
    let cursor = log.boundary();
    // A snapshot newer than the last record (not yet recorded itself) still
    // surfaces as a create, because its rev in the log predates the cursor
    // but its content differs from the log's copy — so it does not depend
    // on `rev > cursor` alone.
    let newer = msg("m1", "hello again");
    let updates = plan_updates(log.plan(&cursor, &[newer]));
    assert_eq!(updates.len(), 1);
}

#[test]
fn a_log_tool_call_missing_from_the_snapshot_gives_full() {
    let mut log = log();
    log.record(&[tool("t1")]);
    let cursor = log.boundary();
    assert_eq!(log.plan(&cursor, &[]), ReplayPlan::Full);
}

#[test]
fn a_deletion_before_its_record_still_clears() {
    // The cache can drop an item, the resume snapshot read that state, and
    // the vanish is recorded only later (`get_resume_snapshot` and
    // `emit_display_for` take the `messages` lock in separate critical
    // sections) — `plan` must clear a log item the snapshot lacks whatever
    // its rev, not just tombstones above the cursor.
    let mut log = log();
    log.record(&[msg("m1", "hello"), msg("m2", "world")]);
    let cursor = log.boundary();
    // m2 vanished from the snapshot, but the log has not recorded that yet.
    let updates = plan_updates(log.plan(&cursor, &[msg("m1", "hello")]));
    assert_eq!(updates.len(), 1);
    assert!(matches!(updates[0], SessionUpdate::AgentMessage(ref u) if u.message_id == "m2"));
}

#[test]
fn seed_sets_the_baseline_without_bumping() {
    let mut log = log();
    log.seed(&[msg("m1", "hello")]);
    assert_eq!(log.boundary().revision, 0);
    // A later identical record is a no-op: the seed already holds it.
    assert_eq!(log.record(&[msg("m1", "hello")]), RecordOutcome::Unchanged);
}

#[test]
fn seed_only_takes_effect_once() {
    let mut log = log();
    log.record(&[msg("m1", "hello")]);
    // Already seeded (by the first record) — a later seed call must not
    // reset state back to a stale snapshot.
    log.seed(&[msg("m1", "stale")]);
    assert_eq!(
        log.record(&[msg("m1", "stale")]),
        RecordOutcome::Recorded(2)
    );
}
