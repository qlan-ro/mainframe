use super::*;

impl IncrementalProjector {
    pub(super) fn full_rebuild(&mut self, input: &ProjectionInput<'_>) -> DisplayDelta {
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
            self.decoders.as_ref(),
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
        self.durable_len = input.raw.len();
        self.refresh_result_dependencies(input.raw, 0);
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
}
