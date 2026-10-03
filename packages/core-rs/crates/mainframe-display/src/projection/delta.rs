//! `DisplayDelta`: the container-level delta a [`super::DisplayProjector`]
//! emits, and its `merge` law used to coalesce buffered deltas.

use std::collections::BTreeMap;

use mainframe_types::display::DisplayMessage;

use super::snapshot::DisplaySnapshot;

/// Counters a projector reports per `project` call. Used by the scaling gate
/// to prove a partial's cost is independent of settled history length.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ProjectionStats {
    /// Raw messages folded (converted or re-scanned) this call.
    pub raw_folded: usize,
    /// Groups rebuilt from scratch (rewound and refolded) this call.
    pub groups_rebuilt: usize,
    /// Containers patched in place (timing, duration, nested) this call.
    pub containers_patched: usize,
    /// 1 if this call produced a full rebuild, else 0.
    pub full_rebuilds: usize,
    /// 1 if a fallback anomaly forced a counted suffix rebuild, else 0.
    pub suffix_rebuilds: usize,
    /// Settled groups scanned this call to recompute frozen claim/scope
    /// state (todo #376 follow-up gate): a projector whose per-call cost is
    /// independent of history keeps this at (or near) 0 regardless of how
    /// much settled history precedes `r`. `IncrementalProjector` looks this
    /// up via persistent indexes instead of rescanning, so it stays flat;
    /// a projector that rebuilds a `HashSet`/`Vec` over `groups[..r]` on
    /// every call would make this grow with settled history length.
    pub frozen_scan_ops: usize,
}

/// A container-level delta. `full: true` means "ignore `changes`/`len`, take
/// `snapshot.materialize()` instead" — the same shape consumers already
/// handle for today's full diff.
#[derive(Clone)]
pub struct DisplayDelta {
    pub full: bool,
    /// Ascending by ordinal. Ordinals at or above `len` were removed.
    pub changes: Vec<(usize, DisplayMessage)>,
    pub len: usize,
    pub snapshot: DisplaySnapshot,
    pub stats: ProjectionStats,
}

impl DisplayDelta {
    /// Coalesce a buffered `self` with a `later` delta. Laws (see the plan's
    /// "Merge" section):
    /// - a later full delta wins outright;
    /// - a full base stays full (the merged result cannot be incremental if
    ///   its starting point required a full snapshot);
    /// - otherwise the result is the union of changes by ordinal, later
    ///   entries winning, with ordinals at or above `later.len` dropped and
    ///   `len = later.len`.
    pub fn merge(self, later: DisplayDelta) -> DisplayDelta {
        if later.full {
            return later;
        }
        if self.full {
            return DisplayDelta {
                full: true,
                changes: Vec::new(),
                len: later.len,
                snapshot: later.snapshot,
                stats: later.stats,
            };
        }
        let mut by_ordinal: BTreeMap<usize, DisplayMessage> = self.changes.into_iter().collect();
        for (ordinal, message) in later.changes {
            by_ordinal.insert(ordinal, message);
        }
        by_ordinal.retain(|&ordinal, _| ordinal < later.len);
        DisplayDelta {
            full: false,
            changes: by_ordinal.into_iter().collect(),
            len: later.len,
            snapshot: later.snapshot,
            stats: later.stats,
        }
    }
}

#[cfg(test)]
mod tests {
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
}
