//! One container's settled state inside the [`super::IncrementalProjector`]
//! (todo #376). Groups partition the raw slice with no gaps: group `i`'s
//! range ends exactly where group `i + 1`'s begins, which lets
//! [`group_at_raw_index`] binary-search a raw index to its owning group in
//! `O(log groups)` instead of a linear scan over settled history.

use std::ops::Range;

use mainframe_types::display::DisplayMessage;
use serde_json::Value;

/// One container's fold state.
pub(crate) struct Group {
    /// The raw indices this group consumed, including trailing filtered
    /// internal-user messages and duration markers absorbed in sequence.
    pub(crate) raw_range: Range<usize>,
    /// Whether this group's base type is assistant/tool_use — the same
    /// condition that makes it eligible to absorb a merge, a tool result, or
    /// a duration-marker patch.
    pub(crate) mergeable: bool,
    /// `None` when conversion suppressed this group (an orphan tool_result)
    /// or a display-id duplicate dropped it.
    pub(crate) display: Option<DisplayMessage>,
    /// This group's ordinal in the materialized list, i.e. its position
    /// among groups with `display.is_some()`. Recomputed after every fold.
    pub(crate) ordinal: Option<usize>,
    /// Tool-use ids this group's content ended up keeping, post cross-group
    /// dedup. Doubles as the id -> owning-group index for an O(1) timing
    /// patch (built by the caller from `claimed_tool_ids` + group index).
    pub(crate) claimed_tool_ids: Vec<String>,
    /// The `turnDurationMs` value a later system marker patched onto this
    /// group, if any — reapplied when this group is re-converted in place.
    pub(crate) duration_override: Option<Value>,
}

/// Binary-search `groups` for the one whose `raw_range` contains `idx`.
/// `groups` must be sorted and gapless (the fold invariant). Panics-free:
/// returns `groups.len().saturating_sub(1)` for an out-of-range `idx` rather
/// than indexing out of bounds, since callers only ever pass indices that
/// were valid at journal-recording time.
pub(crate) fn group_at_raw_index(groups: &[Group], idx: usize) -> usize {
    if groups.is_empty() {
        return 0;
    }
    let mut lo = 0usize;
    let mut hi = groups.len() - 1;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if groups[mid].raw_range.end <= idx {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group(range: Range<usize>) -> Group {
        Group {
            raw_range: range,
            mergeable: false,
            display: None,
            ordinal: None,
            claimed_tool_ids: Vec::new(),
            duration_override: None,
        }
    }

    #[test]
    fn finds_the_group_whose_range_contains_the_index() {
        let groups = vec![group(0..2), group(2..5), group(5..6)];
        assert_eq!(group_at_raw_index(&groups, 0), 0);
        assert_eq!(group_at_raw_index(&groups, 1), 0);
        assert_eq!(group_at_raw_index(&groups, 2), 1);
        assert_eq!(group_at_raw_index(&groups, 4), 1);
        assert_eq!(group_at_raw_index(&groups, 5), 2);
    }

    #[test]
    fn empty_groups_returns_zero() {
        let groups: Vec<Group> = Vec::new();
        assert_eq!(group_at_raw_index(&groups, 3), 0);
    }
}
