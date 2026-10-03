//! Rewind-point computation (todo #376): how far back a partial must
//! re-fold, and the frozen aggregate state (tool ids, display ids, subject
//! scope) a refold from that point needs to seed with.

use mainframe_display::RawChange;

use super::group::{Group, group_at_raw_index};
use crate::messages::task_subject_backfill::SubjectScope;

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
pub(crate) fn apply_structural_entries(
    groups: &[Group],
    entries: &[RawChange],
    mut r: usize,
) -> usize {
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

/// The subject scope entering group `r` — an `O(1)` lookup (a clone of a
/// cached checkpoint) instead of re-walking `groups[..r]` on every call.
/// `scope_before[i]` is the scope entering group `i`, kept in sync with
/// `groups.len() + 1` by [`super::post_process::backfill_tail`]; `r` may
/// legitimately equal `groups.len()` (no rewind), which is why the index is
/// clamped rather than asserted.
pub(crate) fn scope_before(scope_before: &[SubjectScope], r: usize) -> SubjectScope {
    scope_before
        .get(r)
        .cloned()
        .unwrap_or_else(SubjectScope::new)
}

/// The raw index the refold must start from: group `r`'s own start, or —
/// when `r` is past the end (no rewind target, i.e. `r == groups.len()`) —
/// wherever the last group left off. With no groups at all that's raw index
/// 0: nothing has ever been durably folded, so a refold must cover the
/// whole raw slice rather than skip it (todo #376 follow-up). When `groups`
/// is non-empty and `r == groups.len()`, `groups.last().end` already equals
/// `raw.len()` because `baseline_rewind_point` only returns `groups.len()`
/// when nothing (append, overlay now or before) could have grown `raw`
/// since the last fold.
pub(crate) fn refold_start(groups: &[Group], r: usize) -> usize {
    groups
        .get(r)
        .map(|g| g.raw_range.start)
        .unwrap_or_else(|| groups.last().map(|g| g.raw_range.end).unwrap_or(0))
}

/// The raw slice an incremental call must (re)fold: `raw[start..]` plus a
/// synthetic overlay tail, if present.
pub(crate) fn combined_tail(
    raw: &[mainframe_types::chat::ChatMessage],
    start: usize,
    overlay: Option<&mainframe_types::chat::ChatMessage>,
) -> Vec<mainframe_types::chat::ChatMessage> {
    let mut combined = raw[start.min(raw.len())..].to_vec();
    if let Some(overlay) = overlay {
        combined.push(overlay.clone());
    }
    combined
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

/// Display ids owned by the groups about to be discarded — the
/// `display_owner` equivalent of [`ids_owned_by_discarded`].
pub(crate) fn display_ids_owned_by_discarded(groups: &[Group], r: usize) -> Vec<String> {
    groups[r..]
        .iter()
        .filter_map(|g| g.display.as_ref().map(|d| d.id.clone()))
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
