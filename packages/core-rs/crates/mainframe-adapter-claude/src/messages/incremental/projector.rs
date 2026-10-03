//! `IncrementalProjector` (todo #376): the production [`DisplayProjector`]
//! for `mainframe-adapter-claude`. See the module doc
//! (`messages/incremental/mod.rs`) and the plan for the overall design; this
//! file only wires the pieces in `group`, `fold`, `refold`, `patches`,
//! `rewind`, `ordinals`, and `post_process` together.

use std::collections::HashMap;

use mainframe_display::{
    DisplayDelta, DisplayProjector, DisplaySnapshot, ProjectionInput, ProjectionStats, RawChange,
};
use mainframe_types::chat::ChatMessage;
use mainframe_types::display::ToolCategories;

use super::group::{Group, group_at_raw_index};
use super::ordinals::{renumber_from, sync_snapshot, total_len};
use super::patches::{NestedPatchOutcome, apply_timing_patch, try_patch_nested};
use super::post_process::{apply_timing_tail, backfill_tail};
use super::refold::refold_range;
use super::rewind::{apply_structural_entries, baseline_rewind_point, frozen_state, ids_owned_by_discarded, refold_start};
use crate::messages::task_subject_backfill::SubjectScope;

pub struct IncrementalProjector {
    groups: Vec<Group>,
    tool_owner: HashMap<String, usize>,
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
        let combined = combined_tail(input.raw, 0, input.overlay);
        let outcome = refold_range(
            &combined,
            0..combined.len(),
            input.categories,
            &mut [],
            &mut Default::default(),
            &mut Default::default(),
        );
        self.groups = offset_groups(outcome.new_groups, 0);
        let mut scope = SubjectScope::new();
        backfill_tail(&mut self.groups, 0, &mut scope);
        apply_timing_tail(&mut self.groups, input.raw, 0);
        renumber_from(&mut self.groups, 0);
        rebuild_tool_owner(&mut self.tool_owner, &self.groups, 0);

        self.categories = input.categories.cloned();
        self.had_overlay = input.overlay.is_some();
        self.initialized = true;

        let len = total_len(&self.groups);
        let materialized: Vec<_> = self.groups.iter().filter_map(|g| g.display.clone()).collect();
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
        let r = self.apply_local_patches(raw, entries, categories, r, &mut patched, &mut suffix_rebuilds);

        let (mut frozen_tool_ids, mut frozen_display_ids, mut scope) = frozen_state(&self.groups, r);
        let start = refold_start(&self.groups, r, raw.len());
        let combined = combined_tail(raw, start, overlay);

        for id in ids_owned_by_discarded(&self.groups, r) {
            self.tool_owner.remove(&id);
        }
        self.groups.truncate(r);
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

        backfill_tail(&mut self.groups, r, &mut scope);
        apply_timing_tail(&mut self.groups, raw, r);
        renumber_from(&mut self.groups, r);
        rebuild_tool_owner(&mut self.tool_owner, &self.groups, r);

        self.categories = categories.cloned();
        self.had_overlay = overlay_now;

        let len = total_len(&self.groups);
        let changes = self.collect_changes(r, &patched);
        sync_snapshot(&self.snapshot, len, &changes);
        self.stats = ProjectionStats {
            raw_folded: outcome.raw_folded,
            groups_rebuilt,
            containers_patched: patched.len(),
            full_rebuilds: 0,
            suffix_rebuilds,
        };
        DisplayDelta {
            full: false,
            changes,
            len,
            snapshot: self.snapshot.clone(),
            stats: self.stats,
        }
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
                        match try_patch_nested(&mut self.groups, raw, *idx, categories) {
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

fn combined_tail(raw: &[ChatMessage], start: usize, overlay: Option<&ChatMessage>) -> Vec<ChatMessage> {
    let mut combined = raw[start.min(raw.len())..].to_vec();
    if let Some(overlay) = overlay {
        combined.push(overlay.clone());
    }
    combined
}

fn offset_groups(groups: Vec<Group>, offset: usize) -> Vec<Group> {
    groups
        .into_iter()
        .map(|mut g| {
            g.raw_range = (g.raw_range.start + offset)..(g.raw_range.end + offset);
            g
        })
        .collect()
}

fn rebuild_tool_owner(tool_owner: &mut HashMap<String, usize>, groups: &[Group], from: usize) {
    for (idx, group) in groups.iter().enumerate().skip(from) {
        for id in &group.claimed_tool_ids {
            tool_owner.insert(id.clone(), idx);
        }
    }
}
