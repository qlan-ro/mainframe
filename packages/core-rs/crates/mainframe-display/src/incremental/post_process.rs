//! Post-processing a freshly folded tail: subject backfill
//! (continuing the frozen prefix's scope) and per-id tool-call timing, both
//! scoped to only the groups this call actually (re)folded.

use mainframe_types::chat::ChatMessage;

use super::group::Group;
use crate::task_subject_backfill::{SubjectScope, backfill_in_place};

/// Backfill task subjects across `groups[from..]`, continuing `scope` (already
/// positioned at "before `from`"). Rewrites each group's display in place when
/// backfill changed it, and records a `scope_before` checkpoint per group so a
/// later call can look up "the scope entering group `r`" in `O(1)` instead of
/// re-walking `groups[..r]`. `scope_before[i]` is the scope entering group `i`;
/// entries from `from` onward are rebuilt here, matching the groups this call
/// actually touched.
pub(crate) fn backfill_tail(
    groups: &mut [Group],
    from: usize,
    scope: &mut SubjectScope,
    scope_before: &mut Vec<SubjectScope>,
) {
    scope_before.truncate(from);
    for group in &mut groups[from..] {
        scope_before.push(scope.clone());
        let Some(display) = group.display.as_mut() else {
            continue;
        };
        backfill_in_place(std::slice::from_mut(display), scope);
    }
    scope_before.push(scope.clone());
}

/// Apply each newly folded group's own tool-call timing — read only from
/// that group's own raw `ToolUse` blocks, never the rest of history.
pub(crate) fn apply_timing_tail(groups: &mut [Group], raw: &[ChatMessage], from: usize) {
    for group in &mut groups[from..] {
        let Some(display) = group.display.as_mut() else {
            continue;
        };
        let end = group.raw_range.end.min(raw.len());
        let start = group.raw_range.start.min(end);
        crate::apply_tool_call_timing(&raw[start..end], std::slice::from_mut(display));
    }
}

#[cfg(test)]
#[path = "post_process_tests.rs"]
mod tests;
