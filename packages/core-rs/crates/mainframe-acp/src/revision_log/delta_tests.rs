//! `RevisionLog::record_delta` equivalence: outcomes, revision stamps,
//! tombstones, and later `plan` output must match `record`'s for the same
//! sequence of snapshots.

use mainframe_types::acp::tool_call::{ToolCallStatus, ToolKind};
use serde_json::Value;

use super::super::*;
use crate::encoder::ItemRole;
use crate::encoder::delta::EncodedDelta;

fn msg(id: &str, text: &str) -> EncodedItem {
    EncodedItem::Message {
        id: id.to_string(),
        role: ItemRole::Agent,
        content: vec![mainframe_types::acp::content::ContentBlock::Text {
            text: text.to_string(),
            meta: None,
        }],
        meta: None,
    }
}

fn tool(id: &str, status: ToolCallStatus) -> EncodedItem {
    EncodedItem::ToolCall {
        id: id.to_string(),
        title: "Read".to_string(),
        kind: ToolKind::Read,
        status,
        raw_input: Value::Null,
        content: Vec::new(),
        meta: None,
    }
}

fn flatten(containers: &[Vec<EncodedItem>]) -> Vec<EncodedItem> {
    containers.iter().flatten().cloned().collect()
}

fn delta_between(before: &[Vec<EncodedItem>], after: &[Vec<EncodedItem>]) -> EncodedDelta {
    let changes = after
        .iter()
        .enumerate()
        .filter(|(ordinal, items)| before.get(*ordinal) != Some(*items))
        .map(|(ordinal, items)| (ordinal, items.clone()))
        .collect();
    EncodedDelta {
        full: false,
        changes,
        len: after.len(),
    }
}

fn log() -> RevisionLog {
    RevisionLog::new("ep_1".to_string())
}

/// Drives `record` and `record_delta` over the same snapshot history,
/// asserting every step's outcome and resulting boundary agree.
fn assert_record_delta_matches_record(history: &[Vec<Vec<EncodedItem>>]) {
    let mut reference = log();
    let mut actual = log();

    let ref0 = reference.record(&flatten(&history[0]));
    let actual0 = actual.record_delta(&EncodedDelta::full(history[0].clone()), || unreachable!());
    assert_eq!(ref0, actual0, "seeding step outcome");
    assert_eq!(reference.boundary(), actual.boundary());

    for (before, after) in history.iter().zip(history.iter().skip(1)) {
        let ref_outcome = reference.record(&flatten(after));
        let delta = delta_between(before, after);
        let actual_outcome = actual.record_delta(&delta, || unreachable!());
        assert_eq!(ref_outcome, actual_outcome, "step outcome must match");
        assert_eq!(
            reference.boundary(),
            actual.boundary(),
            "revision stamps must match"
        );

        // The later `plan` output, from the cursor just before this step,
        // must agree between the two logs.
        let cursor = RevisionCursor {
            epoch: "ep_1".to_string(),
            revision: reference
                .boundary()
                .revision
                .saturating_sub(1)
                .min(reference.boundary().revision),
        };
        assert_eq!(
            reference.plan(&cursor, &flatten(after)),
            actual.plan(&cursor, &flatten(after)),
            "plan output must match after record_delta"
        );
    }
}

#[test]
fn an_edit_matches_record() {
    let before = vec![vec![msg("a", "hi")], vec![msg("b", "there")]];
    let after = vec![vec![msg("a", "hi")], vec![msg("b", "there now")]];
    assert_record_delta_matches_record(&[before, after]);
}

#[test]
fn an_append_matches_record() {
    let before = vec![vec![msg("a", "hi")]];
    let after = vec![vec![msg("a", "hi")], vec![msg("b", "new")]];
    assert_record_delta_matches_record(&[before, after]);
}

#[test]
fn a_shrink_removing_a_tail_container_matches_record() {
    let before = vec![vec![msg("a", "hi")], vec![msg("b", "bye")]];
    let after = vec![vec![msg("a", "hi")]];
    assert_record_delta_matches_record(&[before, after]);
}

#[test]
fn an_unchanged_step_matches_record() {
    let snapshot = vec![vec![msg("a", "hi")]];
    assert_record_delta_matches_record(&[snapshot.clone(), snapshot]);
}

#[test]
fn a_vanished_tool_call_returns_tool_call_vanished_like_record() {
    let before = vec![vec![msg("a", "hi"), tool("t1", ToolCallStatus::InProgress)]];
    let after = vec![vec![msg("a", "hi edited")]];

    let mut reference = log();
    reference.record(&flatten(&before));
    let ref_outcome = reference.record(&flatten(&after));

    let mut actual = log();
    actual.record_delta(&EncodedDelta::full(before.clone()), || unreachable!());
    let delta = delta_between(&before, &after);
    let actual_outcome = actual.record_delta(&delta, || unreachable!());

    assert_eq!(ref_outcome, RecordOutcome::ToolCallVanished);
    assert_eq!(actual_outcome, RecordOutcome::ToolCallVanished);
}

#[test]
fn an_unseeded_log_records_full_for_an_incremental_delta() {
    let containers = vec![vec![msg("a", "hi")], vec![msg("b", "there")]];
    let delta = EncodedDelta {
        full: false,
        changes: vec![(0, containers[0].clone())],
        len: containers.len(),
    };
    let containers_for_full = containers.clone();

    let mut actual = log();
    let actual_outcome = actual.record_delta(&delta, move || containers_for_full);

    let mut reference = log();
    let ref_outcome = reference.record(&flatten(&containers));

    assert_eq!(actual_outcome, ref_outcome);
    assert_eq!(reference.boundary(), actual.boundary());
}

#[test]
fn items_compared_counts_only_the_affected_containers_items() {
    let before = vec![
        vec![msg("a", "hi")],
        vec![msg("b", "settled 1")],
        vec![msg("c", "settled 2")],
    ];
    let mut actual = log();
    actual.record_delta(&EncodedDelta::full(before.clone()), || unreachable!());
    let compared_after_seed = actual.items_compared();
    assert_eq!(compared_after_seed, 3);

    let delta = EncodedDelta {
        full: false,
        changes: vec![(0, vec![msg("a", "hi edited")])],
        len: 3,
    };
    actual.record_delta(&delta, || unreachable!());

    assert_eq!(
        actual.items_compared(),
        compared_after_seed + 1,
        "only the one affected container's one item was compared"
    );
}
