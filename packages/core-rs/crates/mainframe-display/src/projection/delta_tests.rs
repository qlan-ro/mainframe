use super::*;
use mainframe_types::display::DisplayMessageType;

fn msg(id: &str) -> DisplayMessage {
    DisplayMessage {
        id: id.to_string(),
        chat_id: "c".to_string(),
        r#type: DisplayMessageType::User,
        content: Vec::new(),
        timestamp: "t".to_string(),
        metadata: None,
    }
}

fn delta(full: bool, changes: Vec<(usize, &str)>, len: usize) -> DisplayDelta {
    DisplayDelta {
        full,
        changes: changes.into_iter().map(|(o, id)| (o, msg(id))).collect(),
        len,
        snapshot: DisplaySnapshot::new(Vec::new()),
        stats: ProjectionStats::default(),
    }
}

fn ids(delta: &DisplayDelta) -> Vec<(usize, String)> {
    delta
        .changes
        .iter()
        .map(|(o, m)| (*o, m.id.clone()))
        .collect()
}

#[test]
fn a_later_full_delta_wins_outright() {
    let base = delta(false, vec![(0, "a")], 1);
    let later = delta(true, vec![], 3);
    let merged = base.merge(later);
    assert!(merged.full);
    assert_eq!(merged.len, 3);
}

#[test]
fn a_full_base_stays_full() {
    let base = delta(true, vec![], 5);
    let later = delta(false, vec![(0, "x")], 2);
    let merged = base.merge(later);
    assert!(merged.full);
    assert_eq!(merged.len, 2);
    assert!(merged.changes.is_empty());
}

#[test]
fn a_shrink_then_regrow_keeps_the_later_content() {
    let base = delta(false, vec![(0, "a"), (1, "b"), (2, "c")], 3);
    let shrink = delta(false, vec![], 1); // drops ordinals 1 and 2
    let regrow = delta(false, vec![(1, "b2"), (2, "c2")], 3);

    let merged = base.merge(shrink).merge(regrow);
    assert!(!merged.full);
    assert_eq!(merged.len, 3);
    assert_eq!(
        ids(&merged),
        vec![
            (0, "a".to_string()),
            (1, "b2".to_string()),
            (2, "c2".to_string())
        ]
    );
}

#[test]
fn the_union_keeps_later_entries_on_conflicting_ordinals() {
    let base = delta(false, vec![(0, "a"), (1, "b")], 2);
    let later = delta(false, vec![(1, "b2")], 2);
    let merged = base.merge(later);
    assert_eq!(
        ids(&merged),
        vec![(0, "a".to_string()), (1, "b2".to_string())]
    );
}

#[test]
fn ordinals_at_or_above_the_later_len_are_dropped() {
    let base = delta(false, vec![(0, "a"), (1, "b"), (2, "c")], 3);
    let later = delta(false, vec![(0, "a2")], 1);
    let merged = base.merge(later);
    assert_eq!(merged.len, 1);
    assert_eq!(ids(&merged), vec![(0, "a2".to_string())]);
}
