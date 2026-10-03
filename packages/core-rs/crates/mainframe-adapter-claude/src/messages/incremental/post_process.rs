//! Post-processing a freshly folded tail (todo #376): subject backfill
//! (continuing the frozen prefix's scope) and per-id tool-call timing, both
//! scoped to only the groups this call actually (re)folded.

use mainframe_types::chat::ChatMessage;
use mainframe_types::display::DisplayMessage;

use super::group::Group;
use crate::messages::task_subject_backfill::{SubjectScope, backfill_from};

/// Backfill task subjects across `groups[from..]`, continuing `scope`
/// (already positioned at "before `from`"). Rewrites each group's display
/// in place when backfill changed it.
pub(crate) fn backfill_tail(groups: &mut [Group], from: usize, scope: &mut SubjectScope) {
    let displays: Vec<DisplayMessage> = groups[from..]
        .iter()
        .filter_map(|g| g.display.clone())
        .collect();
    if displays.is_empty() {
        return;
    }
    let backfilled = backfill_from(&displays, scope);
    let mut backfilled = backfilled.into_iter();
    for group in &mut groups[from..] {
        if group.display.is_some() {
            group.display = backfilled.next();
        }
    }
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
        mainframe_display::apply_tool_call_timing(
            &raw[start..end],
            std::slice::from_mut(display),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::display::{DisplayContent, DisplayMessageType, TaskProgressItem, ToolCategory};
    use serde_json::json;
    use std::collections::HashMap;

    fn task_group(ordinal_tag: &str, items: Vec<TaskProgressItem>) -> Group {
        Group {
            raw_range: 0..1,
            mergeable: true,
            display: Some(DisplayMessage {
                id: ordinal_tag.to_string(),
                chat_id: "c".to_string(),
                r#type: DisplayMessageType::Assistant,
                content: vec![DisplayContent::Node(
                    mainframe_types::display::DisplayNode::TaskProgress { items },
                )],
                timestamp: "t".to_string(),
                metadata: None,
            }),
            ordinal: Some(0),
            claimed_tool_ids: Vec::new(),
            duration_override: None,
        }
    }

    fn create_item(id: &str, subject: &str) -> TaskProgressItem {
        TaskProgressItem {
            timing: None,
            id: id.to_string(),
            name: "TaskCreate".to_string(),
            input: HashMap::from([("subject".to_string(), json!(subject))]),
            category: ToolCategory::Progress,
            result: None,
        }
    }

    fn update_item(task_id: &str) -> TaskProgressItem {
        TaskProgressItem {
            timing: None,
            id: format!("u_{task_id}"),
            name: "TaskUpdate".to_string(),
            input: HashMap::from([("taskId".to_string(), json!(task_id))]),
            category: ToolCategory::Progress,
            result: None,
        }
    }

    fn progress_items(group: &Group) -> Vec<TaskProgressItem> {
        let DisplayContent::Node(mainframe_types::display::DisplayNode::TaskProgress { items }) =
            &group.display.as_ref().unwrap().content[0]
        else {
            panic!("expected task progress");
        };
        items.clone()
    }

    #[test]
    fn backfill_tail_continues_a_scope_seeded_from_the_frozen_prefix() {
        let mut scope = crate::messages::task_subject_backfill::scope_after(&[
            task_group("seed", vec![create_item("1", "Seeded task")])
                .display
                .unwrap(),
        ]);
        let mut groups = vec![task_group("tail", vec![update_item("1")])];
        backfill_tail(&mut groups, 0, &mut scope);
        assert_eq!(
            progress_items(&groups[0])[0].input.get("subject"),
            Some(&json!("Seeded task"))
        );
    }
}
