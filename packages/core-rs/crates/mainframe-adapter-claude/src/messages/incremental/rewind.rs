//! Rewind-point computation (todo #376): how far back a partial must
//! re-fold, and the frozen aggregate state (tool ids, display ids, subject
//! scope) a refold from that point needs to seed with.

use std::collections::HashSet;

use mainframe_display::RawChange;
use mainframe_types::display::DisplayMessage;

use super::group::{Group, group_at_raw_index};
use crate::messages::task_subject_backfill::{SubjectScope, scope_after};

/// The baseline rewind point before any `Structural`/fallback lowers it
/// further: the last group when anything was appended, or when the overlay
/// is present now or was present last call. `groups.len()` (a past-the-end
/// sentinel) means "no rewind at all".
pub(crate) fn baseline_rewind_point(
    groups: &[Group],
    had_append: bool,
    overlay_now: bool,
    had_overlay_before: bool,
) -> usize {
    if !(had_append || overlay_now || had_overlay_before) {
        return groups.len();
    }
    groups.len().saturating_sub(1)
}

/// Lower `r` for every `Structural(from)` entry: the group containing
/// `from - 1` (group 0 when `from == 0`).
pub(crate) fn apply_structural_entries(groups: &[Group], entries: &[RawChange], mut r: usize) -> usize {
    for entry in entries {
        if let RawChange::Structural(from) = entry {
            let target = if *from == 0 {
                0
            } else {
                group_at_raw_index(groups, *from - 1)
            };
            r = r.min(target);
        }
    }
    r
}

/// Aggregate the claims and subject scope for `groups[..r]` — the prefix
/// that stays frozen across this call. Bounded by `r`, not total history:
/// in the common hot path `r` sits near `groups.len()`, so this is cheap.
pub(crate) fn frozen_state(groups: &[Group], r: usize) -> (HashSet<String>, HashSet<String>, SubjectScope) {
    let frozen = &groups[..r];
    let tool_ids = frozen
        .iter()
        .flat_map(|g| g.claimed_tool_ids.iter().cloned())
        .collect();
    let display_ids = frozen
        .iter()
        .filter_map(|g| g.display.as_ref().map(|d| d.id.clone()))
        .collect();
    let displays: Vec<DisplayMessage> = frozen
        .iter()
        .filter_map(|g| g.display.clone())
        .collect();
    (tool_ids, display_ids, scope_after(&displays))
}

/// The raw index the refold must start from: group `r`'s own start, or
/// `raw_len` (fold nothing but a possible overlay) when `r` is past the end.
pub(crate) fn refold_start(groups: &[Group], r: usize, raw_len: usize) -> usize {
    groups.get(r).map(|g| g.raw_range.start).unwrap_or(raw_len)
}

/// Tool ids owned by the groups about to be discarded (`groups[r..]`) —
/// these must be dropped from the `tool_owner` index before the new tail is
/// folded in. Bounded by the rewind size, not total history.
pub(crate) fn ids_owned_by_discarded(groups: &[Group], r: usize) -> Vec<String> {
    groups[r..]
        .iter()
        .flat_map(|g| g.claimed_tool_ids.iter().cloned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group(mergeable: bool) -> Group {
        Group {
            raw_range: 0..1,
            mergeable,
            display: None,
            ordinal: None,
            claimed_tool_ids: Vec::new(),
            duration_override: None,
        }
    }

    #[test]
    fn no_signal_means_no_rewind() {
        let groups = vec![group(true), group(false)];
        assert_eq!(baseline_rewind_point(&groups, false, false, false), 2);
    }

    #[test]
    fn append_rewinds_to_the_last_group() {
        let groups = vec![group(true), group(false)];
        assert_eq!(baseline_rewind_point(&groups, true, false, false), 1);
    }

    #[test]
    fn overlay_now_or_before_rewinds_to_the_last_group() {
        let groups = vec![group(true)];
        assert_eq!(baseline_rewind_point(&groups, false, true, false), 0);
        assert_eq!(baseline_rewind_point(&groups, false, false, true), 0);
    }
}
