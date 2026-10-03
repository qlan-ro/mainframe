//! In-place patches (todo #376) that touch one settled group without a
//! rewind: a `timing(id)` change, and a best-effort `nested(index)`
//! re-conversion that falls back to a counted rewind when it cannot stay
//! local (see the plan's "Update dispatch" step 3).

use std::collections::HashSet;

use mainframe_types::display::{DisplayContent, DisplayMessage, DisplayNode, ToolCategories};
use mainframe_types::tool_call_timing::ToolCallTiming;

use super::fold::fold_merge_group;
use super::group::{Group, group_at_raw_index};
use mainframe_display::apply_tool_call_timing_to_container;

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
pub(crate) fn try_patch_nested(
    groups: &mut [Group],
    raw: &[mainframe_types::chat::ChatMessage],
    idx: usize,
    categories: Option<&ToolCategories>,
) -> NestedPatchOutcome {
    let g = group_at_raw_index(groups, idx);
    if !groups[g].mergeable {
        return NestedPatchOutcome::FallBack(g);
    }
    let frozen = claimed_before(groups, g);
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
    if collides_with_later(groups, g, &claimed) {
        return NestedPatchOutcome::FallBack(g);
    }
    if task_registrations_changed(groups[g].display.as_ref(), new_display.as_ref()) {
        return NestedPatchOutcome::FallBack(g);
    }

    groups[g].display = new_display;
    groups[g].claimed_tool_ids = claimed;
    NestedPatchOutcome::Patched(g)
}

fn claimed_before(groups: &[Group], g: usize) -> HashSet<String> {
    groups[..g]
        .iter()
        .flat_map(|group| group.claimed_tool_ids.iter().cloned())
        .collect()
}

fn collides_with_later(groups: &[Group], g: usize, claimed: &[String]) -> bool {
    groups[g + 1..]
        .iter()
        .any(|group| group.claimed_tool_ids.iter().any(|id| claimed.contains(id)))
}

/// The ids of top-level `TaskCreate` entries a container registers — a
/// change here could shift a later group's subject backfill, so it forces a
/// fallback rather than a silent in-place patch.
fn task_registrations_changed(before: Option<&DisplayMessage>, after: Option<&DisplayMessage>) -> bool {
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
