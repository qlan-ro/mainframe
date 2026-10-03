//! `EncodedDelta::merge` laws (todo #376 G2 task 2) — the same laws as
//! `mainframe-display::DisplayDelta::merge` (G1), checked against
//! `EncodedItem` containers instead of `DisplayMessage`s.

use mainframe_types::acp::content::ContentBlock;

use super::*;
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

fn container(items: Vec<EncodedItem>) -> Vec<EncodedItem> {
    items
}

#[test]
fn a_later_full_delta_wins_outright() {
    let earlier = EncodedDelta {
        full: false,
        changes: vec![(0, container(vec![msg("a", "old")]))],
        len: 1,
    };
    let later = EncodedDelta::full(vec![
        container(vec![msg("a", "new")]),
        container(vec![msg("b", "b")]),
    ]);

    let merged = earlier.merge(later.clone());
    assert_eq!(merged, later);
}

#[test]
fn a_shrink_then_regrow_keeps_the_later_content() {
    // Base has three containers. A shrink to len 1 drops 1 and 2. A later
    // regrow back to len 3 with fresh content for 1 and 2 must win outright
    // — the shrink must not leave a stale ordinal 2 behind.
    let base = EncodedDelta {
        full: false,
        changes: vec![
            (0, container(vec![msg("a", "a")])),
            (1, container(vec![msg("b", "b")])),
            (2, container(vec![msg("c", "c")])),
        ],
        len: 3,
    };
    let shrink = EncodedDelta {
        full: false,
        changes: vec![],
        len: 1,
    };
    let regrow = EncodedDelta {
        full: false,
        changes: vec![
            (1, container(vec![msg("b2", "b2")])),
            (2, container(vec![msg("c2", "c2")])),
        ],
        len: 3,
    };

    let merged = base.merge(shrink).merge(regrow.clone());
    assert_eq!(merged.len, 3);
    assert_eq!(
        merged.changes,
        vec![
            (0, container(vec![msg("a", "a")])),
            (1, container(vec![msg("b2", "b2")])),
            (2, container(vec![msg("c2", "c2")])),
        ]
    );
}

#[test]
fn the_union_keeps_later_entries_and_drops_shrunk_ordinals() {
    let earlier = EncodedDelta {
        full: false,
        changes: vec![
            (0, container(vec![msg("a", "a")])),
            (2, container(vec![msg("c", "c")])),
        ],
        len: 3,
    };
    let later = EncodedDelta {
        full: false,
        changes: vec![(1, container(vec![msg("b", "b")]))],
        len: 2,
    };

    let merged = earlier.merge(later);
    // Ordinal 2 is at or above later.len (2), so it is dropped. Ordinal 0
    // survives from earlier; ordinal 1 comes from later.
    assert_eq!(merged.len, 2);
    assert_eq!(
        merged.changes,
        vec![
            (0, container(vec![msg("a", "a")])),
            (1, container(vec![msg("b", "b")])),
        ]
    );
    assert!(!merged.full);
}

#[test]
fn a_full_base_stays_full_after_merging_a_later_incremental_delta() {
    let base = EncodedDelta::full(vec![
        container(vec![msg("a", "a")]),
        container(vec![msg("b", "b")]),
    ]);
    let later = EncodedDelta {
        full: false,
        changes: vec![(1, container(vec![msg("b2", "b2")]))],
        len: 2,
    };

    let merged = base.merge(later);
    assert!(merged.full, "a full base stays full");
    assert_eq!(
        merged.changes,
        vec![
            (0, container(vec![msg("a", "a")])),
            (1, container(vec![msg("b2", "b2")])),
        ]
    );
    assert_eq!(merged.len, 2);
}
