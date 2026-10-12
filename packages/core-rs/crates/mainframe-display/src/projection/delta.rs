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
    /// state: a projector whose per-call cost is
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
    /// Coalesce a buffered `self` with a `later` delta:
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
#[path = "delta_tests.rs"]
mod tests;
