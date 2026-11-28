//! Single-copy container storage.
//!
//! The projector used to hold every container twice: once in its group
//! (`Group::display`, the fold state) and once in the `DisplaySnapshot` list
//! it hands consumers. The list was kept equal to the groups by cloning each
//! changed container into it, so a chat's whole display history sat in memory
//! twice.
//!
//! Now the snapshot list is the only store. At the end of every call each
//! container this call produced moves into the list at its group's ordinal and
//! the group keeps `DisplaySlot::Parked`. A call that patches a settled group
//! in place (a timing patch, a nested re-conversion, a turn-duration marker)
//! first moves that one container back out ([`IncrementalProjector::unpark`]),
//! so the fold code only ever sees owned containers, then [`settle`] returns
//! it. Moving out leaves an empty placeholder, which nothing reads: the group
//! owns the real container until `settle` puts it back.
//!
//! [`settle`]: IncrementalProjector::settle

use super::*;

/// What an unparked group's list slot holds until `settle` refills it. Holds
/// no heap memory.
fn placeholder() -> DisplayMessage {
    DisplayMessage {
        id: String::new(),
        chat_id: String::new(),
        r#type: mainframe_types::display::DisplayMessageType::User,
        content: Vec::new(),
        timestamp: String::new(),
        metadata: None,
    }
}

impl IncrementalProjector {
    /// Move group `gi`'s settled container out of `parked` so this call can
    /// patch it in place. No-op unless the group is parked.
    fn unpark(&mut self, gi: usize, parked: &mut [DisplayMessage]) {
        let Some(group) = self.groups.get_mut(gi) else {
            return;
        };
        if !matches!(group.display, DisplaySlot::Parked) {
            return;
        }
        let Some(slot) = group.ordinal.and_then(|ordinal| parked.get_mut(ordinal)) else {
            return;
        };
        group.display = DisplaySlot::Owned(std::mem::replace(slot, placeholder()));
        self.unparked.push(gi);
    }

    /// Unpark every settled group a timing or nested entry may patch: the
    /// groups below `r` they target. `apply_local_patches` may lower `r`
    /// further; a group unparked here and then rewound past is refolded, and
    /// one left unpatched goes back unchanged.
    pub(super) fn unpark_patch_targets(
        &mut self,
        entries: &[RawChange],
        r: usize,
        parked: &mut [DisplayMessage],
    ) {
        for entry in entries {
            let target = match entry {
                RawChange::Timing(id, _) => self.tool_owner.get(id).copied(),
                RawChange::Nested(idx) => Some(group_at_raw_index(&self.groups, *idx)),
                RawChange::Appended | RawChange::Structural(_) => None,
            };
            if let Some(gi) = target.filter(|&gi| gi < r) {
                self.unpark(gi, parked);
            }
        }
    }

    /// Unpark the one settled group a refold of `tail` can patch in place:
    /// the last mergeable group below the rewind point, which a turn-duration
    /// marker with no open accumulator lands on (`refold.rs` `on_duration`).
    /// Only a tail holding such a marker can patch it. Call after truncating
    /// `groups` to the rewind point.
    pub(super) fn unpark_duration_target(
        &mut self,
        tail: &[ChatMessage],
        parked: &mut [DisplayMessage],
    ) {
        if !tail.iter().any(crate::message_grouping::is_duration_marker) {
            return;
        }
        if let Some(gi) = self.groups.iter().rposition(|group| group.mergeable) {
            self.unpark(gi, parked);
        }
    }

    /// End an incremental call: move every owned container (the refolded tail
    /// from `r`, the patched groups, and anything unparked) into `parked`,
    /// truncated to `len`, and return the changed containers for the delta —
    /// the same `(ordinal, container)` list, in ascending order, that the
    /// snapshot used to be patched from.
    pub(super) fn settle(
        &mut self,
        r: usize,
        patched: &[usize],
        len: usize,
        parked: &mut Vec<DisplayMessage>,
    ) -> Vec<(usize, DisplayMessage)> {
        parked.truncate(len);
        let mut changed: Vec<usize> = patched.to_vec();
        changed.extend(r..self.groups.len());
        changed.sort_unstable();
        changed.dedup();
        let mut owned = std::mem::take(&mut self.unparked);
        owned.extend(changed.iter().copied());
        owned.sort_unstable();
        owned.dedup();
        // Ascending group order is ascending ordinal order, and ordinals are
        // contiguous, so each container either replaces its slot or is the
        // next one pushed.
        for gi in owned {
            let Some(group) = self.groups.get_mut(gi) else {
                continue;
            };
            let Some(ordinal) = group.ordinal else {
                continue;
            };
            let Some(display) = group.display.take_owned() else {
                continue;
            };
            if ordinal < parked.len() {
                parked[ordinal] = display;
            } else {
                parked.push(display);
            }
            group.display = DisplaySlot::Parked;
        }
        changed
            .into_iter()
            .filter_map(|gi| self.groups.get(gi))
            .filter(|group| matches!(group.display, DisplaySlot::Parked))
            .filter_map(|group| {
                let ordinal = group.ordinal?;
                Some((ordinal, parked.get(ordinal)?.clone()))
            })
            .collect()
    }

    /// End a full rebuild: every group owns its freshly folded container, so
    /// the list becomes exactly those containers in group order.
    pub(super) fn park_all(&mut self, parked: &mut Vec<DisplayMessage>) {
        parked.clear();
        self.unparked.clear();
        for group in &mut self.groups {
            if let Some(display) = group.display.take_owned() {
                parked.push(display);
                group.display = DisplaySlot::Parked;
            }
        }
    }
}
