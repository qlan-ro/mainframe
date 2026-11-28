//! One container's settled state inside the [`super::IncrementalProjector`].
//! Groups partition the raw slice with no gaps: group `i`'s
//! range ends exactly where group `i + 1`'s begins, which lets
//! [`group_at_raw_index`] binary-search a raw index to its owning group in
//! `O(log groups)` instead of a linear scan over settled history.

use std::collections::{HashMap, HashSet};
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
    /// The group's container, or where it lives once settled. See
    /// [`DisplaySlot`].
    pub(crate) display: DisplaySlot,
    /// This group's ordinal in the materialized list, i.e. its position
    /// among groups with `display.is_some()`. Recomputed after every fold.
    pub(crate) ordinal: Option<usize>,
    /// Tool-use ids this group's content ended up keeping, post cross-group
    /// dedup. Doubles as the id -> owning-group index for an O(1) timing
    /// patch (built by the caller from `claimed_tool_ids` + group index).
    pub(crate) claimed_tool_ids: Vec<String>,
    // Preserve cross-group completions when a nested update reconverts only this group.
    pub(crate) late_results: HashMap<String, mainframe_types::chat::MessageContent>,
    /// The `turnDurationMs` value a later system marker patched onto this
    /// group, if any — reapplied when this group is re-converted in place.
    pub(crate) duration_override: Option<Value>,
}

/// Where one group's container lives.
///
/// The projector keeps a single copy of every container. A freshly folded
/// group owns its container until the call ends; then the container moves
/// into the projector's `DisplaySnapshot` list at the group's ordinal and the
/// group keeps only `Parked`. A later in-place patch moves it back out
/// (`projector/park.rs`) for the length of that call. The accessors below
/// therefore see only owned containers: a parked group must be unparked
/// before its container is read or patched.
pub(crate) enum DisplaySlot {
    /// No container: conversion suppressed this group (an orphan
    /// tool_result) or a display-id duplicate dropped it.
    None,
    /// The group holds its container for the length of the current call.
    Owned(DisplayMessage),
    /// The container lives in the snapshot list at this group's ordinal.
    Parked,
}

impl DisplaySlot {
    /// Whether the group has a container, wherever it lives.
    pub(crate) fn is_present(&self) -> bool {
        !matches!(self, Self::None)
    }

    pub(crate) fn owned(&self) -> Option<&DisplayMessage> {
        match self {
            Self::Owned(display) => Some(display),
            Self::None | Self::Parked => None,
        }
    }

    pub(crate) fn owned_mut(&mut self) -> Option<&mut DisplayMessage> {
        match self {
            Self::Owned(display) => Some(display),
            Self::None | Self::Parked => None,
        }
    }

    /// Take an owned container, leaving `None`. A parked slot is untouched.
    pub(crate) fn take_owned(&mut self) -> Option<DisplayMessage> {
        if !matches!(self, Self::Owned(_)) {
            return None;
        }
        match std::mem::replace(self, Self::None) {
            Self::Owned(display) => Some(display),
            Self::None | Self::Parked => None,
        }
    }

    /// The container's id: from the slot when owned, else from `parked` at
    /// `ordinal`.
    pub(crate) fn id<'a>(
        &'a self,
        ordinal: Option<usize>,
        parked: &'a [DisplayMessage],
    ) -> Option<&'a str> {
        match self {
            Self::Owned(display) => Some(&display.id),
            Self::Parked => parked.get(ordinal?).map(|display| display.id.as_str()),
            Self::None => None,
        }
    }
}

impl From<Option<DisplayMessage>> for DisplaySlot {
    fn from(display: Option<DisplayMessage>) -> Self {
        display.map_or(Self::None, Self::Owned)
    }
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

/// An `O(1)`-seeded membership check for "is this id claimed by a frozen
/// (settled, not-being-refolded) group" — replaces building a fresh
/// `HashSet` over `groups[..r]` on every call (that scan made a partial's
/// cost grow with settled history length).
///
/// Backed by a persistent id -> owning-group-index map (`tool_owner` or
/// `display_owner`, kept up to date by the projector across rewinds) plus a
/// `local` set for ids claimed by groups folded *during this call*, which
/// have no global index yet.
pub(crate) struct FrozenTracker<'a> {
    owner: &'a HashMap<String, usize>,
    /// An id is frozen when its owning group index is below this.
    threshold: usize,
    local: HashSet<String>,
}

impl<'a> FrozenTracker<'a> {
    pub(crate) fn new(owner: &'a HashMap<String, usize>, threshold: usize) -> Self {
        Self {
            owner,
            threshold,
            local: HashSet::new(),
        }
    }

    pub(crate) fn contains(&self, id: &str) -> bool {
        self.local.contains(id) || self.owner.get(id).is_some_and(|&o| o < self.threshold)
    }

    pub(crate) fn insert(&mut self, id: String) {
        self.local.insert(id);
    }

    pub(crate) fn extend(&mut self, ids: impl IntoIterator<Item = String>) {
        self.local.extend(ids);
    }
}

/// An id is "claimed later" (owned by a group at or above `g + 1`) when its
/// global owner index exceeds `g` — an `O(1)` lookup per id instead of
/// scanning every group after `g`.
pub(crate) fn owned_after(owner: &HashMap<String, usize>, g: usize, ids: &[String]) -> bool {
    ids.iter().any(|id| owner.get(id).is_some_and(|&o| o > g))
}

/// Offset every new group's `raw_range` by `offset` — turns a fold over a
/// `start..` tail slice back into absolute raw indices.
pub(crate) fn offset_groups(groups: Vec<Group>, offset: usize) -> Vec<Group> {
    groups
        .into_iter()
        .map(|mut g| {
            g.raw_range = (g.raw_range.start + offset)..(g.raw_range.end + offset);
            g
        })
        .collect()
}

/// Rebuild the `tool_owner` index for `groups[from..]` after a rewind and
/// refold settled a new tail.
pub(crate) fn rebuild_tool_owner(
    tool_owner: &mut HashMap<String, usize>,
    groups: &[Group],
    from: usize,
) {
    for (idx, group) in groups.iter().enumerate().skip(from) {
        for id in &group.claimed_tool_ids {
            tool_owner.insert(id.clone(), idx);
        }
    }
}

/// The `display_owner` counterpart of [`rebuild_tool_owner`].
pub(crate) fn rebuild_display_owner(
    display_owner: &mut HashMap<String, usize>,
    groups: &[Group],
    from: usize,
    parked: &[DisplayMessage],
) {
    for (idx, group) in groups.iter().enumerate().skip(from) {
        if let Some(id) = group.display.id(group.ordinal, parked) {
            display_owner.insert(id.to_string(), idx);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group(range: Range<usize>) -> Group {
        Group {
            raw_range: range,
            mergeable: false,
            display: DisplaySlot::None,
            ordinal: None,
            claimed_tool_ids: Vec::new(),
            late_results: Default::default(),
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
