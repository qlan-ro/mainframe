//! Cross-message pass that gives every task_progress item a resolvable subject.
//! The CLI's TaskUpdate carries only { taskId, status }; the subject lives on the
//! TaskCreate (possibly in an earlier grouped message). This walks the display
//! list in order, records taskId → subject from TaskCreates, and injects
//! `subject` into later TaskUpdate inputs that lack one.

use std::collections::HashMap;
use std::sync::Arc;

use mainframe_types::display::{
    DisplayContent, DisplayMessage, DisplayMessageType, DisplayNode, TaskProgressItem,
};
use mainframe_types::task_progress::extract_task_id_from_text;
use serde_json::Value;

/// Mutable walk state for one task-id namespace. The incremental projector
/// keeps one checkpoint per group so a refold can resume from the scope
/// entering any group; the subject map is shared copy-on-write, so a
/// checkpoint costs a reference count until the next subject is recorded.
#[derive(Clone)]
pub(crate) struct SubjectScope {
    next_id: i64,
    subjects: Arc<HashMap<String, String>>,
}

impl SubjectScope {
    pub(crate) fn new() -> Self {
        Self {
            next_id: 1,
            subjects: Arc::default(),
        }
    }

    fn record(&mut self, task_id: String, subject: &str) {
        Arc::make_mut(&mut self.subjects).insert(task_id, subject.to_string());
    }
}

/// Fold `messages` through `scope`, continuing from whatever state it
/// already carries, and write each resolved subject into the TaskUpdate
/// inputs that lack one.
pub(crate) fn backfill_in_place(messages: &mut [DisplayMessage], scope: &mut SubjectScope) {
    for message in messages {
        if message.r#type == DisplayMessageType::Assistant {
            backfill_blocks(&mut message.content, scope);
        }
    }
}

fn backfill_blocks(blocks: &mut [DisplayContent], scope: &mut SubjectScope) {
    for block in blocks {
        match block {
            DisplayContent::Node(DisplayNode::TaskGroup { calls, .. }) => {
                backfill_blocks(calls, &mut SubjectScope::new());
            }
            DisplayContent::Node(DisplayNode::TaskProgress { items }) => {
                for item in items {
                    backfill_item(item, scope);
                }
            }
            _ => {}
        }
    }
}

/// A non-string `taskId` (a number, say) as text; `null` or absent is empty.
fn task_id_text(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    }
}

fn non_empty_subject(item: &TaskProgressItem) -> Option<&str> {
    item.input
        .get("subject")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

/// Record a TaskCreate's subject, or give a TaskUpdate that lacks a subject
/// the one recorded for its task.
fn backfill_item(item: &mut TaskProgressItem, scope: &mut SubjectScope) {
    if item.name == "TaskCreate" {
        let id = item
            .result
            .as_ref()
            .and_then(|r| extract_task_id_from_text(&r.content))
            .unwrap_or_else(|| scope.next_id.to_string());
        let n = id.parse::<i64>().unwrap_or(scope.next_id);
        scope.next_id = scope.next_id.max(n).saturating_add(1);
        if let Some(subject) = non_empty_subject(item) {
            scope.record(id, subject);
        }
        return;
    }
    if item.name != "TaskUpdate" {
        return;
    }
    let task_id = task_id_text(item.input.get("taskId"));
    if task_id.is_empty() {
        return;
    }
    if let Some(own) = non_empty_subject(item) {
        // Explicit rename — record it so later updates inherit the new name.
        let own = own.to_string();
        scope.record(task_id, &own);
        return;
    }
    if let Some(known) = scope.subjects.get(&task_id) {
        item.input
            .insert("subject".to_string(), Value::String(known.clone()));
    }
}

#[cfg(test)]
#[path = "task_subject_backfill_tests.rs"]
mod tests;
