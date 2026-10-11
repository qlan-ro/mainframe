//! `SessionState::apply` equivalence: for a sequence of container snapshots,
//! the updates `apply` produces from deltas must equal `diff` on the flattened
//! snapshots, in order — while comparing only the affected containers' items.

use mainframe_types::acp::tool_call::{ToolCallStatus, ToolKind};

use super::super::*;
use crate::encoder::delta::EncodedDelta;
use crate::encoder::{EncodedItem, ItemRole};

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

fn tool(id: &str, status: ToolCallStatus) -> EncodedItem {
    EncodedItem::ToolCall {
        id: id.to_string(),
        title: "Read".to_string(),
        kind: ToolKind::Read,
        status,
        raw_input: serde_json::Value::Null,
        content: Vec::new(),
        meta: None,
    }
}

fn flatten(containers: &[Vec<EncodedItem>]) -> Vec<EncodedItem> {
    containers.iter().flatten().cloned().collect()
}

/// Builds the delta a projector would emit moving from `before` to `after`:
/// every ordinal whose container differs becomes a `changes` entry.
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

/// Runs `diff` over the whole history, then `apply` (seeded via a `full`
/// delta from `history[0]`, then one incremental delta per later step) over
/// the same history, and asserts every step's updates agree.
fn assert_apply_matches_diff(history: &[Vec<Vec<EncodedItem>>]) {
    let mut reference = SessionState::new();
    let mut actual = SessionState::new();
    actual.apply(&EncodedDelta::full(history[0].clone()), || unreachable!());
    let _ = reference.diff(&flatten(&history[0]));

    for (before, after) in history.iter().zip(history.iter().skip(1)) {
        let expected = reference.diff(&flatten(after));
        let delta = delta_between(before, after);
        let got = actual.apply(&delta, || unreachable!());
        assert_eq!(got, expected, "apply must equal diff on the flattened step");
    }
}

#[test]
fn an_edit_to_one_container_matches_diff() {
    let before = vec![vec![msg("a", "hi")], vec![msg("b", "there")]];
    let after = vec![vec![msg("a", "hi")], vec![msg("b", "there now")]];
    assert_apply_matches_diff(&[before, after]);
}

#[test]
fn an_append_matches_diff() {
    let before = vec![vec![msg("a", "hi")]];
    let after = vec![vec![msg("a", "hi")], vec![msg("b", "new")]];
    assert_apply_matches_diff(&[before, after]);
}

#[test]
fn a_shrink_removing_a_tail_container_matches_diff() {
    let before = vec![vec![msg("a", "hi")], vec![msg("b", "bye")]];
    let after = vec![vec![msg("a", "hi")]];
    assert_apply_matches_diff(&[before, after]);
}

#[test]
fn a_moved_item_id_matches_diff() {
    // "b" moves from container 1 to a new container 0's partner slot — model
    // as container 1 losing it and a new container 2 gaining it.
    let before = vec![
        vec![msg("a", "hi")],
        vec![msg("b", "moved"), msg("c", "stay")],
    ];
    let after = vec![
        vec![msg("a", "hi")],
        vec![msg("c", "stay")],
        vec![msg("b", "moved")],
    ];
    assert_apply_matches_diff(&[before, after]);
}

#[test]
fn a_vanished_tool_call_matches_diff_by_leaving_it_uncleared() {
    let before = vec![vec![msg("a", "hi"), tool("t1", ToolCallStatus::InProgress)]];
    let after = vec![vec![msg("a", "hi edited")]];
    assert_apply_matches_diff(&[before, after]);
}

#[test]
fn a_meta_only_change_matches_diff() {
    let mut changed = msg("a", "hi");
    if let EncodedItem::Message { meta, .. } = &mut changed {
        *meta = Some(serde_json::json!({"x": 1}));
    }
    let before = vec![vec![msg("a", "hi")]];
    let after = vec![vec![changed]];
    assert_apply_matches_diff(&[before, after]);
}

#[test]
fn a_streaming_flag_clearing_matches_diff() {
    let mut streaming = msg("a", "partial");
    if let EncodedItem::Message { meta, .. } = &mut streaming {
        *meta = Some(serde_json::json!({ "_mainframe.dev": { "streaming": true } }));
    }
    let settled = msg("a", "partial");
    let before = vec![vec![streaming]];
    let after = vec![vec![settled]];
    assert_apply_matches_diff(&[before, after]);
}

#[test]
fn a_fresh_unseeded_state_given_an_incremental_delta_matches_diff_on_full() {
    let containers = vec![vec![msg("a", "hi")], vec![msg("b", "there")]];
    let delta = EncodedDelta {
        full: false,
        changes: vec![(0, containers[0].clone())],
        len: containers.len(),
    };
    let containers_for_full = containers.clone();

    let mut actual = SessionState::new();
    let got = actual.apply(&delta, move || containers_for_full);

    let mut reference = SessionState::new();
    let expected = reference.diff(&flatten(&containers));

    assert_eq!(got, expected);
}

#[test]
fn items_compared_counts_only_the_affected_containers_items() {
    let before = vec![
        vec![msg("a", "hi")],
        vec![msg("b", "settled 1")],
        vec![msg("c", "settled 2")],
    ];
    let mut state = SessionState::new();
    state.apply(&EncodedDelta::full(before.clone()), || unreachable!());
    let compared_after_seed = state.items_compared();
    assert_eq!(compared_after_seed, 3);

    let delta = EncodedDelta {
        full: false,
        changes: vec![(0, vec![msg("a", "hi edited")])],
        len: 3,
    };
    state.apply(&delta, || unreachable!());

    assert_eq!(
        state.items_compared(),
        compared_after_seed + 1,
        "only the one affected container's one item was compared"
    );
}
