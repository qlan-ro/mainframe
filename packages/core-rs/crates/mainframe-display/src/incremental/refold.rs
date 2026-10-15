//! The sequential driver: walks one raw slice left to right,
//! opening/closing merge-group accumulators via the shared
//! [`classify_message`] decision and appending finished [`Group`]s. A
//! duration marker may target a group this call already finished, or a
//! frozen group from an earlier call — both patch in place rather than
//! rewinding.

use std::ops::Range;

use mainframe_types::chat::{ChatMessage, ChatMessageType};
use mainframe_types::display::ToolCategories;
use serde_json::Value;

use super::fold::{convert_single_message, fold_merge_group};
use super::group::{FrozenTracker, Group};
use crate::display_helpers::is_internal_user_message;
use crate::message_grouping::{GroupingDecision, classify_message, is_assistant_or_tool_use};
use crate::turn_boundary::OpenTurn;

/// The result of one [`refold_range`] call.
pub(crate) struct RefoldOutcome {
    pub(crate) new_groups: Vec<Group>,
    pub(crate) raw_folded: usize,
    /// Indices into `existing` that a duration marker patched in place.
    pub(crate) patched_existing: Vec<usize>,
}

pub(crate) fn refold_range<'o>(
    raw: &[ChatMessage],
    range: Range<usize>,
    categories: Option<&ToolCategories>,
    decoders: &dyn crate::ToolResultDecoders,
    existing: &mut [Group],
    frozen_tool_ids: &mut FrozenTracker<'o>,
    frozen_display_ids: &mut FrozenTracker<'o>,
) -> RefoldOutcome {
    let mut walker = Walker {
        raw,
        categories,
        decoders,
        frozen_tool_ids,
        frozen_display_ids,
        new_groups: Vec::new(),
        cur_start: None,
        open_turn: OpenTurn::default(),
        pending_start: range.start,
        pending_duration: None,
        patched_existing: Vec::new(),
    };
    for idx in range.clone() {
        walker.step(idx, existing);
    }
    walker.finish(range.end);
    RefoldOutcome {
        new_groups: walker.new_groups,
        raw_folded: range.len(),
        patched_existing: walker.patched_existing,
    }
}

struct Walker<'a, 'o> {
    raw: &'a [ChatMessage],
    categories: Option<&'a ToolCategories>,
    decoders: &'a dyn crate::ToolResultDecoders,
    frozen_tool_ids: &'a mut FrozenTracker<'o>,
    frozen_display_ids: &'a mut FrozenTracker<'o>,
    new_groups: Vec<Group>,
    /// Start of the currently open mergeable accumulator, if any.
    cur_start: Option<usize>,
    /// Turn key of the open accumulator; a known change closes it.
    open_turn: OpenTurn,
    /// Start of whatever group comes next — absorbs any leading
    /// filtered/duration-marker indices that didn't start a group of their
    /// own, so every group's `raw_range` stays gapless.
    pending_start: usize,
    pending_duration: Option<Value>,
    patched_existing: Vec<usize>,
}

impl Walker<'_, '_> {
    fn step(&mut self, idx: usize, existing: &mut [Group]) {
        let msg = &self.raw[idx];
        if msg.r#type == ChatMessageType::User && is_internal_user_message(&msg.content) {
            return;
        }
        // A refold starts at a group start, which follows either an
        // unmergeable group or a turn boundary, so an open accumulator that
        // admits this message's turn is the only way to merge here.
        let prev_mergeable = self.cur_start.is_some() && self.open_turn.admits(msg);
        match classify_message(msg, prev_mergeable) {
            GroupingDecision::DurationMarker(duration) => self.on_duration(duration, existing),
            GroupingDecision::AttachResult => self.open_merge(idx),
            GroupingDecision::Merge => {
                self.open_turn.observe(msg);
                self.open_merge(idx);
            }
            GroupingDecision::NewGroup if is_assistant_or_tool_use(msg.r#type) => {
                // This message starts a fresh mergeable run (the same case
                // `group_messages` handles by pushing a new `GroupedMessage`
                // that a later assistant/tool_use message can still merge
                // into). A turn boundary first closes the run still open.
                self.close_open_accumulator(idx);
                self.open_turn = OpenTurn::starting_with(msg);
                self.open_merge(idx);
            }
            GroupingDecision::NewGroup => {
                self.close_open_accumulator(idx);
                self.on_new_group(idx, msg);
            }
        }
    }

    fn open_merge(&mut self, idx: usize) {
        self.cur_start.get_or_insert(idx);
    }

    fn close_open_accumulator(&mut self, end: usize) {
        if let Some(start) = self.cur_start.take() {
            self.close_merge_group(start, end);
        }
    }

    fn on_duration(&mut self, duration: Value, existing: &mut [Group]) {
        if self.cur_start.is_some() {
            self.pending_duration = Some(duration);
            return;
        }
        if let Some(last) = self.new_groups.last_mut()
            && last.mergeable
        {
            patch_duration_in_place(last, duration);
            return;
        }
        if let Some(idx) = last_mergeable_index(existing) {
            patch_duration_in_place(&mut existing[idx], duration);
            self.patched_existing.push(idx);
        }
        // No preceding assistant group anywhere: dropped silently, matching
        // the full pipeline. Either way this index is absorbed into
        // whatever group is built next (`pending_start` is untouched).
    }

    fn on_new_group(&mut self, idx: usize, msg: &ChatMessage) {
        let display = convert_single_message(msg, self.categories, self.decoders);
        let display = self.dedupe_display_id(display);
        self.new_groups.push(Group {
            raw_range: self.pending_start..idx + 1,
            mergeable: false,
            display,
            ordinal: None,
            claimed_tool_ids: Vec::new(),
            duration_override: None,
        });
        self.pending_start = idx + 1;
    }

    fn close_merge_group(&mut self, start: usize, end: usize) {
        let duration = self.pending_duration.take();
        let (display, claimed) = fold_merge_group(
            self.raw,
            start..end,
            duration.as_ref(),
            self.categories,
            self.decoders,
            self.frozen_tool_ids,
        );
        self.frozen_tool_ids.extend(claimed.iter().cloned());
        let display = self.dedupe_display_id(display);
        self.new_groups.push(Group {
            raw_range: self.pending_start..end,
            mergeable: true,
            display,
            ordinal: None,
            claimed_tool_ids: claimed,
            duration_override: duration,
        });
        self.pending_start = end;
    }

    /// Close any still-open accumulator, then widen the last group (or defer
    /// via `pending_start`, if nothing was ever created) to cover any
    /// trailing absorbed-only indices.
    fn finish(&mut self, range_end: usize) {
        if let Some(start) = self.cur_start.take() {
            self.close_merge_group(start, range_end);
        }
        if self.pending_start < range_end {
            if let Some(last) = self.new_groups.last_mut() {
                last.raw_range.end = range_end;
            }
            self.pending_start = range_end;
        }
    }

    fn dedupe_display_id(
        &mut self,
        display: Option<mainframe_types::display::DisplayMessage>,
    ) -> Option<mainframe_types::display::DisplayMessage> {
        let display = display?;
        if self.frozen_display_ids.contains(&display.id) {
            return None;
        }
        self.frozen_display_ids.insert(display.id.clone());
        Some(display)
    }
}

fn patch_duration_in_place(group: &mut Group, duration: Value) {
    group.duration_override = Some(duration.clone());
    if let Some(display) = group.display.as_mut() {
        let mut meta = display.metadata.take().unwrap_or_default();
        meta.insert("turnDurationMs".to_string(), duration);
        display.metadata = Some(meta);
    }
}

fn last_mergeable_index(existing: &[Group]) -> Option<usize> {
    existing.iter().rposition(|g| g.mergeable)
}
