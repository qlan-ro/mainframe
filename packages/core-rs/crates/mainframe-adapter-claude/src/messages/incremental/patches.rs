//! In-place patches that touch one settled group without a rewind: a
//! `timing(id)` change, and a best-effort `nested(index)` re-conversion that
//! falls back to a counted rewind when it cannot stay local.

use std::collections::{HashMap, HashSet};

use mainframe_types::chat::ChatMessage;
use mainframe_types::display::{DisplayContent, DisplayMessage, DisplayNode, ToolCategories};
use mainframe_types::tool_call_timing::ToolCallTiming;

use super::fold::fold_merge_group;
use super::group::{FrozenTracker, Group, group_at_raw_index, owned_after};
use crate::messages::task_subject_backfill::{SubjectScope, backfill_from};
use mainframe_display::{apply_tool_call_timing, apply_tool_call_timing_to_container};

/// Patch the owning group's container for a `timing(id)` journal entry.
/// `O(1)`: a map lookup (the caller resolves `group_idx` from `tool_owner`)
/// plus a single-node patch, never a rescan of raw history.
pub(crate) fn apply_timing_patch(
    groups: &mut [Group],
    group_idx: usize,
    id: &str,
    timing: Option<ToolCallTiming>,
) {
    if let Some(group) = groups.get_mut(group_idx)
        && let Some(display) = group.display.as_mut()
    {
        apply_tool_call_timing_to_container(display, id, timing);
    }
}

/// Outcome of attempting to patch a `nested(index)` target in place.
pub(crate) enum NestedPatchOutcome {
    /// Patched; carries the group's index so the caller can mark its
    /// ordinal changed.
    Patched(usize),
    /// Cannot patch safely; the caller must rewind from this group index
    /// instead (a counted suffix rebuild).
    FallBack(usize),
}

/// Re-convert the group owning raw index `idx` using its *current* raw
/// content, reusing its cached duration override. Falls back to a rewind
/// when the patch would ripple beyond this one group: a display-presence
/// flip, a top-level task-registration change (which could shift later
/// groups' subject backfill), or a tool id now colliding with a later,
/// already-settled group.
///
/// On success, re-applies the two post-processing passes a tail refold
/// would have given this group — its own tool-call timing
/// (`apply_timing_tail`'s per-group pass) and subject backfill continuing
/// the scope entering it (`backfill_tail`) — so an in-place patch produces
/// exactly what a rewind through this group would have (a raw
/// `fold_merge_group` result always carries `timing: None` and no backfilled
/// subject).
pub(crate) fn try_patch_nested(
    groups: &mut [Group],
    raw: &[ChatMessage],
    idx: usize,
    categories: Option<&ToolCategories>,
    tool_owner: &HashMap<String, usize>,
    scope_before_g: SubjectScope,
) -> NestedPatchOutcome {
    let g = group_at_raw_index(groups, idx);
    if !groups[g].mergeable {
        return NestedPatchOutcome::FallBack(g);
    }
    let frozen = FrozenTracker::new(tool_owner, g);
    let (new_display, claimed) = fold_merge_group(
        raw,
        groups[g].raw_range.clone(),
        groups[g].duration_override.as_ref(),
        categories,
        &frozen,
    );

    if new_display.is_some() != groups[g].display.is_some() {
        return NestedPatchOutcome::FallBack(g);
    }
    if owned_after(tool_owner, g, &claimed) {
        return NestedPatchOutcome::FallBack(g);
    }
    if task_registrations_changed(groups[g].display.as_ref(), new_display.as_ref()) {
        return NestedPatchOutcome::FallBack(g);
    }

    groups[g].display = new_display;
    groups[g].claimed_tool_ids = claimed;
    reapply_post_processing(groups, raw, g, scope_before_g);
    NestedPatchOutcome::Patched(g)
}

/// Mirrors `apply_timing_tail` + `backfill_tail` for exactly this one
/// group: its own raw range for timing, and the scope entering it (passed
/// in by the caller from the `scope_before` checkpoint) for subject
/// backfill.
fn reapply_post_processing(
    groups: &mut [Group],
    raw: &[ChatMessage],
    g: usize,
    mut scope: SubjectScope,
) {
    let Some(display) = groups[g].display.as_mut() else {
        return;
    };
    let end = groups[g].raw_range.end.min(raw.len());
    let start = groups[g].raw_range.start.min(end);
    apply_tool_call_timing(&raw[start..end], std::slice::from_mut(display));

    let Some(display) = groups[g].display.take() else {
        return;
    };
    let backfilled = backfill_from(std::slice::from_ref(&display), &mut scope);
    groups[g].display = backfilled.into_iter().next();
}

/// The ids of top-level `TaskCreate` entries a container registers — a
/// change here could shift a later group's subject backfill, so it forces a
/// fallback rather than a silent in-place patch.
fn task_registrations_changed(
    before: Option<&DisplayMessage>,
    after: Option<&DisplayMessage>,
) -> bool {
    task_create_ids(before) != task_create_ids(after)
}

fn task_create_ids(display: Option<&DisplayMessage>) -> HashSet<String> {
    let Some(display) = display else {
        return HashSet::new();
    };
    display
        .content
        .iter()
        .filter_map(|c| match c {
            DisplayContent::Node(DisplayNode::TaskProgress { items }) => Some(items),
            _ => None,
        })
        .flat_map(|items| items.iter())
        .filter(|item| item.name == "TaskCreate")
        .map(|item| item.id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::display::{DisplayMessageType, TaskProgressItem, ToolCategory};

    fn task_progress_display(items: Vec<TaskProgressItem>) -> DisplayMessage {
        DisplayMessage {
            id: "m".to_string(),
            chat_id: "c".to_string(),
            r#type: DisplayMessageType::Assistant,
            content: vec![DisplayContent::Node(DisplayNode::TaskProgress { items })],
            timestamp: "t".to_string(),
            metadata: None,
        }
    }

    fn create_item(id: &str) -> TaskProgressItem {
        TaskProgressItem {
            timing: None,
            id: id.to_string(),
            name: "TaskCreate".to_string(),
            input: Default::default(),
            category: ToolCategory::Progress,
            result: None,
        }
    }

    #[test]
    fn detects_a_new_task_registration() {
        let before = task_progress_display(vec![]);
        let after = task_progress_display(vec![create_item("t1")]);
        assert!(task_registrations_changed(Some(&before), Some(&after)));
    }

    #[test]
    fn stable_registrations_do_not_trip_the_fallback() {
        let before = task_progress_display(vec![create_item("t1")]);
        let after = task_progress_display(vec![create_item("t1")]);
        assert!(!task_registrations_changed(Some(&before), Some(&after)));
    }
}
