//! Ported from `packages/core/src/messages/task-subject-backfill.ts`.
//!
//! Cross-message pass that gives every task_progress item a resolvable subject.
//! The CLI's TaskUpdate carries only { taskId, status }; the subject lives on the
//! TaskCreate (possibly in an earlier grouped message). This walks the display
//! list in order, records taskId → subject from TaskCreates, and injects
//! `subject` into later TaskUpdate inputs that lack one.
//!
//! CRATE-SPLIT NOTE (PORTING §2.5): like message_grouping, this file operates on
//! the neutral `DisplayMessage`/`DisplayContent` pipeline (no Claude JSONL/event
//! shapes) yet was scaffolded into `adapter-claude::messages`; its consumer
//! `display_pipeline` lives in `mainframe-display`. The Phase-B reviewer decides
//! its final home. The TS test's `prepareMessagesForClient` integration block is
//! NOT ported here (it belongs to display_pipeline, which is unported and on the
//! other side of the dependency edge); only the `backfillTaskSubjects` unit
//! assertions are ported.

use std::collections::HashMap;

use mainframe_types::display::{
    DisplayContent, DisplayMessage, DisplayMessageType, DisplayNode, TaskProgressItem,
};
use mainframe_types::task_progress::extract_task_id;
use serde_json::Value;

/// Mutable walk state for one task-id namespace.
struct SubjectScope {
    next_id: i64,
    subjects: HashMap<String, String>,
}

impl SubjectScope {
    fn new() -> Self {
        Self {
            next_id: 1,
            subjects: HashMap::new(),
        }
    }
}

pub fn backfill_task_subjects(messages: &[DisplayMessage]) -> Vec<DisplayMessage> {
    let mut scope = SubjectScope::new();
    messages
        .iter()
        .map(|msg| {
            if msg.r#type != DisplayMessageType::Assistant {
                return msg.clone();
            }
            match backfill_blocks(&msg.content, &mut scope) {
                None => msg.clone(),
                Some(content) => DisplayMessage {
                    content,
                    ..msg.clone()
                },
            }
        })
        .collect()
}

/// Returns `None` when nothing changed (mirrors the TS same-reference return).
fn backfill_blocks(
    blocks: &[DisplayContent],
    scope: &mut SubjectScope,
) -> Option<Vec<DisplayContent>> {
    let mut changed = false;
    let mut next: Vec<DisplayContent> = Vec::with_capacity(blocks.len());
    for block in blocks {
        match block {
            DisplayContent::Node(DisplayNode::TaskGroup {
                agent_id,
                task_args,
                calls,
                result,
            }) => {
                let mut inner = SubjectScope::new();
                match backfill_blocks(calls, &mut inner) {
                    None => next.push(block.clone()),
                    Some(new_calls) => {
                        changed = true;
                        next.push(DisplayContent::Node(DisplayNode::TaskGroup {
                            agent_id: agent_id.clone(),
                            task_args: task_args.clone(),
                            calls: new_calls,
                            result: result.clone(),
                        }));
                    }
                }
            }
            DisplayContent::Node(DisplayNode::TaskProgress { items }) => {
                let mut items_changed = false;
                let new_items: Vec<TaskProgressItem> = items
                    .iter()
                    .map(|item| match backfill_item(item, scope) {
                        Some(new_item) => {
                            items_changed = true;
                            new_item
                        }
                        None => item.clone(),
                    })
                    .collect();
                if !items_changed {
                    next.push(block.clone());
                } else {
                    changed = true;
                    next.push(DisplayContent::Node(DisplayNode::TaskProgress {
                        items: new_items,
                    }));
                }
            }
            other => next.push(other.clone()),
        }
    }
    if changed { Some(next) } else { None }
}

/// `String(x ?? '')` — coerce a non-string JSON value the way JS would.
fn js_string_coerce(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(other) => other.to_string(),
    }
}

/// Returns `Some(new_item)` only when the item is rewritten (TaskUpdate gains a
/// subject); `None` leaves the item unchanged (but may mutate `scope`).
fn backfill_item(item: &TaskProgressItem, scope: &mut SubjectScope) -> Option<TaskProgressItem> {
    if item.name == "TaskCreate" {
        let result_val = item
            .result
            .as_ref()
            .and_then(|r| serde_json::to_value(r).ok())
            .unwrap_or(Value::Null);
        let id = extract_task_id(&result_val).unwrap_or_else(|| scope.next_id.to_string());
        let n = id.parse::<i64>().unwrap_or(scope.next_id);
        scope.next_id = scope.next_id.max(n) + 1;
        if let Some(subject) = item
            .input
            .get("subject")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            scope.subjects.insert(id, subject.to_string());
        }
        return None;
    }
    if item.name == "TaskUpdate" {
        let task_id = match item.input.get("taskId") {
            Some(Value::String(s)) => s.clone(),
            other => js_string_coerce(other),
        };
        if let Some(own) = item
            .input
            .get("subject")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            // Explicit rename — record it so later updates inherit the new name.
            if !task_id.is_empty() {
                scope.subjects.insert(task_id, own.to_string());
            }
            return None;
        }
        let known = if !task_id.is_empty() {
            scope.subjects.get(&task_id).cloned()
        } else {
            None
        };
        let known = known?;
        let mut new_input = item.input.clone();
        new_input.insert("subject".to_string(), Value::String(known));
        return Some(TaskProgressItem {
            input: new_input,
            ..item.clone()
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::display::{ToolCallResult, ToolCategory};
    use serde_json::json;

    fn create_item(id: &str, subject: &str) -> TaskProgressItem {
        TaskProgressItem {
            id: format!("toolu_create_{id}"),
            name: "TaskCreate".to_string(),
            input: [("subject".to_string(), json!(subject))]
                .into_iter()
                .collect(),
            category: ToolCategory::Progress,
            result: Some(ToolCallResult {
                content: format!("Task #{id} created successfully: {subject}"),
                is_error: false,
                structured_patch: None,
                original_file: None,
                modified_file: None,
                truncated: None,
                full_bytes: None,
                ask_user_question: None,
            }),
        }
    }

    fn update_item(task_id: &str, status: &str, extra: Vec<(&str, Value)>) -> TaskProgressItem {
        let mut input: HashMap<String, Value> = HashMap::new();
        input.insert("taskId".to_string(), json!(task_id));
        input.insert("status".to_string(), json!(status));
        for (k, v) in extra {
            input.insert(k.to_string(), v);
        }
        TaskProgressItem {
            id: format!("toolu_update_{task_id}_{status}"),
            name: "TaskUpdate".to_string(),
            input,
            category: ToolCategory::Progress,
            result: Some(ToolCallResult {
                content: format!("Updated task #{task_id} status"),
                is_error: false,
                structured_patch: None,
                original_file: None,
                modified_file: None,
                truncated: None,
                full_bytes: None,
                ask_user_question: None,
            }),
        }
    }

    fn assistant_msg(id: &str, items: Vec<TaskProgressItem>) -> DisplayMessage {
        DisplayMessage {
            id: id.to_string(),
            chat_id: "chat-1".to_string(),
            timestamp: "2026-07-04T00:00:00Z".to_string(),
            r#type: DisplayMessageType::Assistant,
            content: vec![DisplayContent::Node(DisplayNode::TaskProgress { items })],
            metadata: None,
        }
    }

    fn progress_items(msg: &DisplayMessage) -> Vec<TaskProgressItem> {
        for c in &msg.content {
            if let DisplayContent::Node(DisplayNode::TaskProgress { items }) = c {
                return items.clone();
            }
        }
        Vec::new()
    }

    #[test]
    fn injects_taskcreate_subject_into_a_later_taskupdate() {
        let messages = vec![
            assistant_msg(
                "m1",
                vec![
                    create_item("9", "Task 3: silent reconcile"),
                    create_item("10", "Task 4: history unwrap"),
                ],
            ),
            assistant_msg("m2", vec![update_item("9", "in_progress", vec![])]),
            assistant_msg(
                "m3",
                vec![
                    update_item("9", "completed", vec![]),
                    update_item("10", "in_progress", vec![]),
                ],
            ),
        ];
        let out = backfill_task_subjects(&messages);
        assert_eq!(
            progress_items(&out[1])[0].input.get("subject"),
            Some(&json!("Task 3: silent reconcile"))
        );
        assert_eq!(
            progress_items(&out[2])[0].input.get("subject"),
            Some(&json!("Task 3: silent reconcile"))
        );
        assert_eq!(
            progress_items(&out[2])[1].input.get("subject"),
            Some(&json!("Task 4: history unwrap"))
        );
    }

    #[test]
    fn leaves_taskupdate_with_subject_and_records_rename() {
        let messages = vec![
            assistant_msg("m1", vec![create_item("1", "Old name")]),
            assistant_msg(
                "m2",
                vec![update_item(
                    "1",
                    "in_progress",
                    vec![("subject", json!("New name"))],
                )],
            ),
            assistant_msg("m3", vec![update_item("1", "completed", vec![])]),
        ];
        let out = backfill_task_subjects(&messages);
        assert_eq!(
            progress_items(&out[1])[0].input.get("subject"),
            Some(&json!("New name"))
        );
        assert_eq!(
            progress_items(&out[2])[0].input.get("subject"),
            Some(&json!("New name"))
        );
    }

    #[test]
    fn leaves_unknown_taskids_unchanged() {
        let messages = vec![assistant_msg(
            "m1",
            vec![update_item("42", "completed", vec![])],
        )];
        let out = backfill_task_subjects(&messages);
        assert_eq!(progress_items(&out[0])[0].input.get("subject"), None);
        assert_eq!(
            progress_items(&out[0])[0].input.get("taskId"),
            Some(&json!("42"))
        );
    }

    #[test]
    fn falls_back_to_sequential_ids_for_pending_create() {
        let pending = TaskProgressItem {
            id: "toolu_create_pending".to_string(),
            name: "TaskCreate".to_string(),
            input: [("subject".to_string(), json!("Streaming task"))]
                .into_iter()
                .collect(),
            category: ToolCategory::Progress,
            result: None,
        };
        let messages = vec![
            assistant_msg("m1", vec![pending]),
            assistant_msg("m2", vec![update_item("1", "in_progress", vec![])]),
        ];
        let out = backfill_task_subjects(&messages);
        assert_eq!(
            progress_items(&out[1])[0].input.get("subject"),
            Some(&json!("Streaming task"))
        );
    }

    #[test]
    fn continues_sequential_fallback_after_result_ids() {
        let pending = TaskProgressItem {
            id: "toolu_create_pending2".to_string(),
            name: "TaskCreate".to_string(),
            input: [("subject".to_string(), json!("Sixth task"))]
                .into_iter()
                .collect(),
            category: ToolCategory::Progress,
            result: None,
        };
        let messages = vec![
            assistant_msg("m1", vec![create_item("5", "Fifth task"), pending]),
            assistant_msg("m2", vec![update_item("6", "completed", vec![])]),
        ];
        let out = backfill_task_subjects(&messages);
        assert_eq!(
            progress_items(&out[1])[0].input.get("subject"),
            Some(&json!("Sixth task"))
        );
    }

    #[test]
    fn scopes_subagent_task_progress_separately() {
        let nested = DisplayContent::Node(DisplayNode::TaskGroup {
            agent_id: "agent-1".to_string(),
            task_args: HashMap::new(),
            calls: vec![DisplayContent::Node(DisplayNode::TaskProgress {
                items: vec![
                    create_item("1", "Subagent task"),
                    update_item("1", "completed", vec![]),
                ],
            })],
            result: None,
        });
        let messages = vec![
            assistant_msg("m1", vec![create_item("1", "Main task")]),
            DisplayMessage {
                id: "m2".to_string(),
                chat_id: "chat-1".to_string(),
                timestamp: "2026-07-04T00:00:01Z".to_string(),
                r#type: DisplayMessageType::Assistant,
                content: vec![
                    nested,
                    DisplayContent::Node(DisplayNode::TaskProgress {
                        items: vec![update_item("1", "in_progress", vec![])],
                    }),
                ],
                metadata: None,
            },
        ];
        let out = backfill_task_subjects(&messages);
        let group = out[1]
            .content
            .iter()
            .find_map(|c| match c {
                DisplayContent::Node(DisplayNode::TaskGroup { calls, .. }) => Some(calls),
                _ => None,
            })
            .expect("missing task_group");
        let nested_progress = group
            .iter()
            .find_map(|c| match c {
                DisplayContent::Node(DisplayNode::TaskProgress { items }) => Some(items),
                _ => None,
            })
            .expect("missing nested task_progress");
        assert_eq!(
            nested_progress[1].input.get("subject"),
            Some(&json!("Subagent task"))
        );
        assert_eq!(
            progress_items(&out[1])[0].input.get("subject"),
            Some(&json!("Main task"))
        );
    }

    #[test]
    fn does_not_mutate_input_messages() {
        let messages = vec![
            assistant_msg("m1", vec![create_item("1", "A task")]),
            assistant_msg("m2", vec![update_item("1", "completed", vec![])]),
        ];
        let snapshot = messages.clone();
        let _ = backfill_task_subjects(&messages);
        assert_eq!(messages, snapshot);
    }

    #[test]
    fn coerces_numeric_taskid() {
        let numeric_update = TaskProgressItem {
            id: "toolu_update_3_numeric".to_string(),
            name: "TaskUpdate".to_string(),
            input: [
                ("taskId".to_string(), json!(3)),
                ("status".to_string(), json!("completed")),
            ]
            .into_iter()
            .collect(),
            category: ToolCategory::Progress,
            result: Some(ToolCallResult {
                content: "Updated task #3 status".to_string(),
                is_error: false,
                structured_patch: None,
                original_file: None,
                modified_file: None,
                truncated: None,
                full_bytes: None,
                ask_user_question: None,
            }),
        };
        let messages = vec![
            assistant_msg("m1", vec![create_item("3", "Numeric taskId task")]),
            assistant_msg("m2", vec![numeric_update]),
        ];
        let out = backfill_task_subjects(&messages);
        assert_eq!(
            progress_items(&out[1])[0].input.get("subject"),
            Some(&json!("Numeric taskId task"))
        );
    }

    #[test]
    fn passes_non_assistant_messages_through() {
        let user = DisplayMessage {
            id: "u1".to_string(),
            chat_id: "chat-1".to_string(),
            timestamp: "2026-07-04T00:00:00Z".to_string(),
            r#type: DisplayMessageType::User,
            content: vec![DisplayContent::Leaf(
                mainframe_types::content::LeafContent::Text {
                    text: "hello".to_string(),
                    parent_tool_use_id: None,
                },
            )],
            metadata: None,
        };
        let out = backfill_task_subjects(std::slice::from_ref(&user));
        assert_eq!(out[0], user);
    }
}

// PORT STATUS: src/messages/task-subject-backfill.ts (88 lines)
// confidence: high
// todos: 0
// notes: backfill_blocks returns Option<Vec> (Some=changed) to mirror the TS
// same-reference optimization; non-mutation of inputs is guaranteed by taking
// &[DisplayMessage]. item.result (Option<ToolCallResult>) is serialized to a
// Value for extract_task_id (types crate). js_string_coerce reproduces
// String(taskId ?? ''). 9 backfillTaskSubjects unit assertions ported; the TS
// prepareMessagesForClient integration block is intentionally NOT ported here —
// it exercises display_pipeline (mainframe-display) across the dependency edge.
// CRATE-SPLIT flagged (see module doc) — likely re-homes to mainframe-display.
