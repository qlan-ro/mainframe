//! Cross-message pass that gives every task_progress item a resolvable subject.
//! The CLI's TaskUpdate carries only { taskId, status }; the subject lives on the
//! TaskCreate (possibly in an earlier grouped message). This walks the display
//! list in order, records taskId → subject from TaskCreates, and injects
//! `subject` into later TaskUpdate inputs that lack one.

use std::collections::HashMap;

use mainframe_types::display::{
    DisplayContent, DisplayMessage, DisplayMessageType, DisplayNode, TaskProgressItem,
};
use mainframe_types::task_progress::extract_task_id;
use serde_json::Value;

/// Mutable walk state for one task-id namespace. `pub(crate)` so the
/// incremental projector can carry a scope across a rewind: it
/// computes the scope *before* the rewind point by folding
/// [`scope_after`] over the settled prefix, then continues the same fold
/// via [`backfill_from`] over the refolded suffix, so a resumed fold
/// produces exactly the subjects a full walk from index 0 would.
#[derive(Clone)]
pub(crate) struct SubjectScope {
    next_id: i64,
    subjects: HashMap<String, String>,
}

impl SubjectScope {
    pub(crate) fn new() -> Self {
        Self {
            next_id: 1,
            subjects: HashMap::new(),
        }
    }
}

pub(crate) fn backfill_task_subjects(messages: &[DisplayMessage]) -> Vec<DisplayMessage> {
    let mut scope = SubjectScope::new();
    backfill_from(messages, &mut scope)
}

/// Fold `messages` through `scope`, continuing from whatever state it
/// already carries. Mirrors `backfill_task_subjects`'s per-message walk.
pub(crate) fn backfill_from(
    messages: &[DisplayMessage],
    scope: &mut SubjectScope,
) -> Vec<DisplayMessage> {
    messages
        .iter()
        .map(|msg| {
            if msg.r#type != DisplayMessageType::Assistant {
                return msg.clone();
            }
            match backfill_blocks(&msg.content, scope) {
                None => msg.clone(),
                Some(content) => DisplayMessage {
                    content,
                    ..msg.clone()
                },
            }
        })
        .collect()
}

/// The scope after folding `messages` from a fresh namespace — used to seed
/// a resumed fold over a later suffix without re-walking from index 0.
/// `pub(crate)` for its unit test below only; production code gets this
/// from the incremental projector's cached `scope_before` checkpoints
/// instead (see `messages/incremental/rewind.rs`).
#[cfg(test)]
pub(crate) fn scope_after(messages: &[DisplayMessage]) -> SubjectScope {
    let mut scope = SubjectScope::new();
    let _ = backfill_from(messages, &mut scope);
    scope
}

/// Returns `None` when nothing changed.
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
                timing,
            }) => {
                let mut inner = SubjectScope::new();
                match backfill_blocks(calls, &mut inner) {
                    None => next.push(block.clone()),
                    Some(new_calls) => {
                        changed = true;
                        next.push(DisplayContent::Node(DisplayNode::TaskGroup {
                            timing: *timing,
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
#[path = "task_subject_backfill_tests.rs"]
mod tests;
