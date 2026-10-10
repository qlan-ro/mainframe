//! `IncrementalProjector`: the production [`DisplayProjector`]. See the
//! module doc (`messages/incremental/mod.rs`) for the overall design; this
//! file only wires the pieces in `group`, `fold`, `refold`, `patches`,
//! `rewind`, `ordinals`, and `post_process` together.

use std::collections::HashMap;

use mainframe_display::{
    DisplayDelta, DisplayProjector, DisplaySnapshot, ProjectionInput, ProjectionStats, RawChange,
};
use mainframe_types::chat::ChatMessage;
use mainframe_types::display::ToolCategories;

use super::group::{
    FrozenTracker, Group, group_at_raw_index, offset_groups, rebuild_display_owner,
    rebuild_tool_owner,
};
use super::ordinals::{renumber_from, sync_snapshot, total_len};
use super::patches::{NestedPatchOutcome, apply_timing_patch, try_patch_nested};
use super::post_process::{apply_timing_tail, backfill_tail};
use super::refold::refold_range;
use super::rewind::{
    apply_structural_entries, baseline_rewind_point, combined_tail, display_ids_owned_by_discarded,
    ids_owned_by_discarded, refold_start, scope_before,
};
use crate::messages::task_subject_backfill::SubjectScope;

pub struct IncrementalProjector {
    groups: Vec<Group>,
    tool_owner: HashMap<String, usize>,
    /// Display-id -> owning-group-index index, the `display_owner`
    /// counterpart of `tool_owner`: lets a dedupe
    /// check against the frozen prefix be an `O(1)` lookup instead of a
    /// fresh `HashSet` built over `groups[..r]` on every call.
    display_owner: HashMap<String, usize>,
    /// `scope_before[i]` is the task-subject scope entering group `i`,
    /// kept in sync with `groups.len() + 1` by `backfill_tail`. Lets "the
    /// scope before `r`" be an `O(1)` clone instead of re-walking
    /// `groups[..r]`.
    scope_before: Vec<SubjectScope>,
    categories: Option<ToolCategories>,
    had_overlay: bool,
    initialized: bool,
    snapshot: DisplaySnapshot,
    stats: ProjectionStats,
}

impl Default for IncrementalProjector {
    fn default() -> Self {
        Self {
            groups: Vec::new(),
            tool_owner: HashMap::new(),
            display_owner: HashMap::new(),
            scope_before: Vec::new(),
            categories: None,
            had_overlay: false,
            initialized: false,
            snapshot: DisplaySnapshot::new(Vec::new()),
            stats: ProjectionStats::default(),
        }
    }
}

impl IncrementalProjector {
    pub fn new() -> Self {
        Self::default()
    }
}

impl DisplayProjector for IncrementalProjector {
    fn project(&mut self, mut input: ProjectionInput<'_>) -> DisplayDelta {
        let categories_changed = input.categories != self.categories.as_ref();
        if !self.initialized || categories_changed {
            return self.full_rebuild(&input);
        }
        let entries = input.changes.drain();
        self.incremental(input.raw, &entries, input.overlay, input.categories)
    }
}

impl IncrementalProjector {
    fn full_rebuild(&mut self, input: &ProjectionInput<'_>) -> DisplayDelta {
        self.groups.clear();
        self.tool_owner.clear();
        self.display_owner.clear();
        self.scope_before.clear();
        let combined = combined_tail(input.raw, 0, input.overlay);
        let empty_tool_owner = HashMap::new();
        let empty_display_owner = HashMap::new();
        let outcome = refold_range(
            &combined,
            0..combined.len(),
            input.categories,
            &mut [],
            &mut FrozenTracker::new(&empty_tool_owner, 0),
            &mut FrozenTracker::new(&empty_display_owner, 0),
        );
        self.groups = offset_groups(outcome.new_groups, 0);
        let mut scope = SubjectScope::new();
        backfill_tail(&mut self.groups, 0, &mut scope, &mut self.scope_before);
        apply_timing_tail(&mut self.groups, input.raw, 0);
        renumber_from(&mut self.groups, 0);
        rebuild_tool_owner(&mut self.tool_owner, &self.groups, 0);
        rebuild_display_owner(&mut self.display_owner, &self.groups, 0);

        self.categories = input.categories.cloned();
        self.had_overlay = input.overlay.is_some();
        self.initialized = true;

        let len = total_len(&self.groups);
        let materialized: Vec<_> = self
            .groups
            .iter()
            .filter_map(|g| g.display.clone())
            .collect();
        self.snapshot.replace(materialized);
        self.stats = ProjectionStats {
            raw_folded: input.raw.len(),
            full_rebuilds: 1,
            ..ProjectionStats::default()
        };
        DisplayDelta {
            full: true,
            changes: Vec::new(),
            len,
            snapshot: self.snapshot.clone(),
            stats: self.stats,
        }
    }

    fn incremental(
        &mut self,
        raw: &[ChatMessage],
        entries: &[RawChange],
        overlay: Option<&ChatMessage>,
        categories: Option<&ToolCategories>,
    ) -> DisplayDelta {
        let had_append = entries.iter().any(|c| matches!(c, RawChange::Appended));
        let overlay_now = overlay.is_some();
        let base_r = baseline_rewind_point(&self.groups, had_append, overlay_now, self.had_overlay);
        let r = apply_structural_entries(&self.groups, entries, base_r);

        let mut suffix_rebuilds = 0usize;
        let mut patched: Vec<usize> = Vec::new();
        let r = self.apply_local_patches(
            raw,
            entries,
            categories,
            r,
            &mut patched,
            &mut suffix_rebuilds,
        );

        let (groups_rebuilt, raw_folded) =
            self.refold_and_postprocess(raw, overlay, categories, r, &mut patched);

        self.categories = categories.cloned();
        self.had_overlay = overlay_now;

        let len = total_len(&self.groups);
        let changes = self.collect_changes(r, &patched);
        sync_snapshot(&self.snapshot, len, &changes);
        self.stats = ProjectionStats {
            raw_folded,
            groups_rebuilt,
            containers_patched: patched.len(),
            full_rebuilds: 0,
            suffix_rebuilds,
            frozen_scan_ops: 0,
        };
        DisplayDelta {
            full: false,
            changes,
            len,
            snapshot: self.snapshot.clone(),
            stats: self.stats,
        }
    }

    /// Truncate `groups` to `r`, refold the combined raw/overlay tail, and
    /// run the two tail post-processing passes (subject backfill, tool-call
    /// timing) — the shared body of an incremental call once the rewind
    /// point and local patches are settled. Returns `(groups_rebuilt,
    /// raw_folded)` for the caller's `ProjectionStats`.
    ///
    /// `O(1)` setup: a cheap clone of a cached `scope_before` checkpoint
    /// plus two index-backed `FrozenTracker`s, never a rescan of
    /// `groups[..r]`.
    fn refold_and_postprocess(
        &mut self,
        raw: &[ChatMessage],
        overlay: Option<&ChatMessage>,
        categories: Option<&ToolCategories>,
        r: usize,
        patched: &mut Vec<usize>,
    ) -> (usize, usize) {
        let mut scope = scope_before(&self.scope_before, r);
        let start = refold_start(&self.groups, r);
        let combined = combined_tail(raw, start, overlay);

        // Ids owned by groups[r..] all have owner >= r, so dropping them
        // before the trackers borrow the maps below doesn't change which
        // ids read as frozen (owner < r).
        for id in ids_owned_by_discarded(&self.groups, r) {
            self.tool_owner.remove(&id);
        }
        for id in display_ids_owned_by_discarded(&self.groups, r) {
            self.display_owner.remove(&id);
        }
        self.groups.truncate(r);

        let mut frozen_tool_ids = FrozenTracker::new(&self.tool_owner, r);
        let mut frozen_display_ids = FrozenTracker::new(&self.display_owner, r);
        let outcome = refold_range(
            &combined,
            0..combined.len(),
            categories,
            &mut self.groups,
            &mut frozen_tool_ids,
            &mut frozen_display_ids,
        );
        patched.extend(outcome.patched_existing.iter().copied());
        let groups_rebuilt = outcome.new_groups.len();
        self.groups.extend(offset_groups(outcome.new_groups, start));

        backfill_tail(&mut self.groups, r, &mut scope, &mut self.scope_before);
        apply_timing_tail(&mut self.groups, raw, r);
        renumber_from(&mut self.groups, r);
        rebuild_tool_owner(&mut self.tool_owner, &self.groups, r);
        rebuild_display_owner(&mut self.display_owner, &self.groups, r);

        (groups_rebuilt, outcome.raw_folded)
    }

    /// Timing and nested patches, applied before the rewind truncates
    /// anything. A nested patch that cannot stay local reports its target
    /// group so the caller folds it into `r`.
    fn apply_local_patches(
        &mut self,
        raw: &[ChatMessage],
        entries: &[RawChange],
        categories: Option<&ToolCategories>,
        mut r: usize,
        patched: &mut Vec<usize>,
        suffix_rebuilds: &mut usize,
    ) -> usize {
        for entry in entries {
            match entry {
                RawChange::Timing(id, timing) => {
                    if let Some(&gi) = self.tool_owner.get(id)
                        && gi < r
                    {
                        apply_timing_patch(&mut self.groups, gi, id, *timing);
                        patched.push(gi);
                    }
                }
                RawChange::Nested(idx) => {
                    let gi = group_at_raw_index(&self.groups, *idx);
                    if gi < r {
                        let old_ids = self.groups[gi].claimed_tool_ids.clone();
                        let scope = scope_before(&self.scope_before, gi);
                        match try_patch_nested(
                            &mut self.groups,
                            raw,
                            *idx,
                            categories,
                            &self.tool_owner,
                            scope,
                        ) {
                            NestedPatchOutcome::Patched(p) => {
                                for id in &old_ids {
                                    self.tool_owner.remove(id);
                                }
                                for id in &self.groups[p].claimed_tool_ids {
                                    self.tool_owner.insert(id.clone(), p);
                                }
                                patched.push(p);
                            }
                            NestedPatchOutcome::FallBack(p) => {
                                *suffix_rebuilds += 1;
                                r = r.min(p);
                            }
                        }
                    }
                }
                RawChange::Appended | RawChange::Structural(_) => {}
            }
        }
        r
    }

    fn collect_changes(
        &self,
        r: usize,
        patched: &[usize],
    ) -> Vec<(usize, mainframe_types::display::DisplayMessage)> {
        let mut ordinals: Vec<usize> = patched.to_vec();
        ordinals.extend(r..self.groups.len());
        ordinals.sort_unstable();
        ordinals.dedup();
        ordinals
            .into_iter()
            .filter_map(|gi| self.groups.get(gi))
            .filter_map(|g| Some((g.ordinal?, g.display.clone()?)))
            .collect()
    }
}
