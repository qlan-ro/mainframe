//! Ported from `src/todos/normalize.ts`.

use std::collections::HashMap;

use mainframe_types::chat::{TodoItem, TodoStatus};
use serde::Deserialize;
use serde_json::Value;

/// The three sources that can produce a TodoItem list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TodoSource {
    TodoV1,
    TaskV2,
    CodexTodoList,
}

/// A single V2 task event (TaskCreate, TaskUpdate, TaskStop). Kept for callers
/// that build events in Rust; `normalize_todos` itself reads the raw `Value`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskV2Event {
    pub tool_name: String,
    #[serde(default)]
    pub args: serde_json::Map<String, Value>,
    #[serde(default)]
    pub result: Option<Value>,
}

/// Internal mutable task state used while accumulating V2 events.
struct TaskState {
    subject: String,
    status: String,
    active_form: String,
}

/// Normalize raw payload from a given source into a canonical `TodoItem` list.
pub fn normalize_todos(source: TodoSource, payload: &Value) -> Vec<TodoItem> {
    match source {
        TodoSource::TodoV1 => normalize_todo_v1(payload),
        TodoSource::TaskV2 => normalize_task_v2(payload),
        TodoSource::CodexTodoList => normalize_codex_todo_list(payload),
    }
}

fn normalize_todo_v1(payload: &Value) -> Vec<TodoItem> {
    let Some(arr) = payload.as_array() else {
        return Vec::new();
    };
    arr.iter()
        .filter(|t| {
            t.is_object()
                && t.get("content").and_then(Value::as_str).is_some()
                && t.get("status").and_then(Value::as_str).is_some()
        })
        // The TS returns matching items as-is; the typed TodoItem requires a valid
        // status + activeForm, so a bad status / missing activeForm drops the item
        // (untested divergence from the unchecked JS pass-through).
        .filter_map(|t| serde_json::from_value::<TodoItem>(t.clone()).ok())
        .collect()
}

fn normalize_task_v2(payload: &Value) -> Vec<TodoItem> {
    let Some(events) = payload.as_array() else {
        return Vec::new();
    };

    let mut list: Vec<TaskState> = Vec::new();
    let mut map: HashMap<String, usize> = HashMap::new();

    for event in events {
        let tool_name = event.get("toolName").and_then(Value::as_str);
        let args = event.get("args");
        match tool_name {
            Some("TaskCreate") => {
                let result_str = event.get("result").and_then(Value::as_str).unwrap_or("");
                let id =
                    extract_task_number(result_str).unwrap_or_else(|| (map.len() + 1).to_string());
                let subject = arg_str(args, "subject")
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("Task #{id}"));
                let active_form = arg_str(args, "activeForm")
                    .map(str::to_string)
                    .unwrap_or_else(|| subject.clone());
                let idx = list.len();
                list.push(TaskState {
                    subject,
                    status: "pending".to_string(),
                    active_form,
                });
                map.insert(id, idx);
            }
            Some("TaskUpdate") => {
                let task_id = arg_str(args, "taskId").unwrap_or("");
                let new_status = arg_str(args, "status").unwrap_or("");
                if let Some(&idx) = map.get(task_id) {
                    if !new_status.is_empty() {
                        list[idx].status = new_status.to_string();
                    }
                    if let Some(subject) = arg_str(args, "subject") {
                        list[idx].subject = subject.to_string();
                    }
                    if let Some(active_form) = arg_str(args, "activeForm") {
                        list[idx].active_form = active_form.to_string();
                    }
                } else if !task_id.is_empty() {
                    let subject = arg_str(args, "subject")
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("Task #{task_id}"));
                    let status = if new_status.is_empty() {
                        "pending".to_string()
                    } else {
                        new_status.to_string()
                    };
                    let idx = list.len();
                    list.push(TaskState {
                        subject: subject.clone(),
                        status,
                        active_form: subject,
                    });
                    map.insert(task_id.to_string(), idx);
                }
            }
            Some("TaskStop") => {
                let task_id = arg_str(args, "taskId").unwrap_or("");
                if let Some(&idx) = map.get(task_id) {
                    list[idx].status = "deleted".to_string();
                }
            }
            _ => {}
        }
    }

    list.into_iter()
        .filter(|t| t.status != "deleted")
        .map(|t| TodoItem {
            content: t.subject,
            status: task_status_to_todo_status(&t.status),
            active_form: t.active_form,
        })
        .collect()
}

/// `(event.args.<key> as string) || fallback` — a present, non-empty string.
fn arg_str<'a>(args: Option<&'a Value>, key: &str) -> Option<&'a str> {
    args?
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

fn extract_task_number(s: &str) -> Option<String> {
    let idx = s.find("Task #")?;
    let rest = &s[idx + "Task #".len()..];
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() {
        None
    } else {
        Some(digits)
    }
}

fn task_status_to_todo_status(status: &str) -> TodoStatus {
    match status {
        "completed" => TodoStatus::Completed,
        "in_progress" => TodoStatus::InProgress,
        _ => TodoStatus::Pending,
    }
}

fn normalize_codex_todo_list(payload: &Value) -> Vec<TodoItem> {
    let Some(arr) = payload.as_array() else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|t| {
            let text = t.get("text").and_then(Value::as_str)?;
            let completed = t.get("completed").and_then(Value::as_bool).unwrap_or(false);
            Some(TodoItem {
                content: text.to_string(),
                status: if completed {
                    TodoStatus::Completed
                } else {
                    TodoStatus::Pending
                },
                active_form: text.to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn todo(content: &str, status: TodoStatus, active_form: &str) -> TodoItem {
        TodoItem {
            content: content.to_string(),
            status,
            active_form: active_form.to_string(),
        }
    }

    // --- todoV1 ---

    #[test]
    fn todo_v1_returns_valid_items_as_is() {
        let input = json!([
            { "content": "Write tests", "status": "pending", "activeForm": "Write tests" },
            { "content": "Fix bug", "status": "in_progress", "activeForm": "Fixing the bug" },
            { "content": "Ship it", "status": "completed", "activeForm": "Ship it" },
        ]);
        assert_eq!(
            normalize_todos(TodoSource::TodoV1, &input),
            vec![
                todo("Write tests", TodoStatus::Pending, "Write tests"),
                todo("Fix bug", TodoStatus::InProgress, "Fixing the bug"),
                todo("Ship it", TodoStatus::Completed, "Ship it"),
            ]
        );
    }

    #[test]
    fn todo_v1_filters_out_items_missing_content_or_status() {
        let input = json!([
            { "content": "Valid", "status": "pending", "activeForm": "Valid" },
            { "status": "pending" },
            { "content": "Also valid", "status": "completed", "activeForm": "" },
        ]);
        let result = normalize_todos(TodoSource::TodoV1, &input);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].content, "Valid");
        assert_eq!(result[1].content, "Also valid");
    }

    #[test]
    fn todo_v1_returns_empty_for_non_array_payload() {
        assert!(normalize_todos(TodoSource::TodoV1, &json!(null)).is_empty());
        assert!(normalize_todos(TodoSource::TodoV1, &json!("string")).is_empty());
        assert!(normalize_todos(TodoSource::TodoV1, &json!({})).is_empty());
    }

    #[test]
    fn todo_v1_returns_empty_for_empty_input() {
        assert!(normalize_todos(TodoSource::TodoV1, &json!([])).is_empty());
    }

    // --- taskV2 ---

    #[test]
    fn task_v2_maps_task_create_events_to_pending_todos() {
        let events = json!([
            { "toolName": "TaskCreate", "args": { "subject": "Write tests", "activeForm": "Writing tests" }, "result": "Task #1 created" },
        ]);
        let result = normalize_todos(TodoSource::TaskV2, &events);
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            todo("Write tests", TodoStatus::Pending, "Writing tests")
        );
    }

    #[test]
    fn task_v2_update_changes_status_of_existing_task() {
        let events = json!([
            { "toolName": "TaskCreate", "args": { "subject": "Task A" }, "result": "Task #1 created" },
            { "toolName": "TaskUpdate", "args": { "taskId": "1", "status": "in_progress" } },
        ]);
        let result = normalize_todos(TodoSource::TaskV2, &events);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].status, TodoStatus::InProgress);
    }

    #[test]
    fn task_v2_update_marks_task_completed() {
        let events = json!([
            { "toolName": "TaskCreate", "args": { "subject": "Task A" }, "result": "Task #1 created" },
            { "toolName": "TaskUpdate", "args": { "taskId": "1", "status": "completed" } },
        ]);
        let result = normalize_todos(TodoSource::TaskV2, &events);
        assert_eq!(result[0].status, TodoStatus::Completed);
    }

    #[test]
    fn task_v2_stop_removes_task_from_list() {
        let events = json!([
            { "toolName": "TaskCreate", "args": { "subject": "Task A" }, "result": "Task #1 created" },
            { "toolName": "TaskCreate", "args": { "subject": "Task B" }, "result": "Task #2 created" },
            { "toolName": "TaskStop", "args": { "taskId": "1" } },
        ]);
        let result = normalize_todos(TodoSource::TaskV2, &events);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].content, "Task B");
    }

    #[test]
    fn task_v2_handles_multiple_create_events() {
        let events = json!([
            { "toolName": "TaskCreate", "args": { "subject": "Alpha" }, "result": "Task #1 created" },
            { "toolName": "TaskCreate", "args": { "subject": "Beta" }, "result": "Task #2 created" },
            { "toolName": "TaskCreate", "args": { "subject": "Gamma" }, "result": "Task #3 created" },
        ]);
        let result = normalize_todos(TodoSource::TaskV2, &events);
        assert_eq!(result.len(), 3);
        assert_eq!(
            result
                .iter()
                .map(|t| t.content.as_str())
                .collect::<Vec<_>>(),
            vec!["Alpha", "Beta", "Gamma"]
        );
    }

    #[test]
    fn task_v2_returns_empty_for_empty_event_list() {
        assert!(normalize_todos(TodoSource::TaskV2, &json!([])).is_empty());
    }

    #[test]
    fn task_v2_returns_empty_for_non_array_payload() {
        assert!(normalize_todos(TodoSource::TaskV2, &json!(null)).is_empty());
    }

    #[test]
    fn task_v2_mid_task_update_preserves_other_tasks() {
        let events = json!([
            { "toolName": "TaskCreate", "args": { "subject": "Task 1" }, "result": "Task #1 created" },
            { "toolName": "TaskCreate", "args": { "subject": "Task 2" }, "result": "Task #2 created" },
            { "toolName": "TaskUpdate", "args": { "taskId": "1", "status": "in_progress" } },
        ]);
        let result = normalize_todos(TodoSource::TaskV2, &events);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].status, TodoStatus::InProgress);
        assert_eq!(result[1].status, TodoStatus::Pending);
    }

    #[test]
    fn task_v2_update_for_unknown_task_id_creates_new_entry() {
        let events = json!([
            { "toolName": "TaskUpdate", "args": { "taskId": "99", "status": "in_progress", "subject": "Mystery Task" } },
        ]);
        let result = normalize_todos(TodoSource::TaskV2, &events);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].content, "Mystery Task");
        assert_eq!(result[0].status, TodoStatus::InProgress);
    }

    // --- codexTodoList ---

    #[test]
    fn codex_maps_items_to_pending_completed() {
        let items = json!([
            { "text": "Write tests", "completed": false },
            { "text": "Fix bug", "completed": true },
        ]);
        assert_eq!(
            normalize_todos(TodoSource::CodexTodoList, &items),
            vec![
                todo("Write tests", TodoStatus::Pending, "Write tests"),
                todo("Fix bug", TodoStatus::Completed, "Fix bug"),
            ]
        );
    }

    #[test]
    fn codex_returns_empty_for_empty_items() {
        assert!(normalize_todos(TodoSource::CodexTodoList, &json!([])).is_empty());
    }

    #[test]
    fn codex_returns_empty_for_non_array_payload() {
        assert!(normalize_todos(TodoSource::CodexTodoList, &json!(null)).is_empty());
        assert!(normalize_todos(TodoSource::CodexTodoList, &json!({})).is_empty());
    }

    #[test]
    fn codex_filters_out_items_without_text_field() {
        let items = json!([
            { "text": "Valid", "completed": false },
            { "completed": true },
            { "text": "Also valid", "completed": false },
        ]);
        assert_eq!(normalize_todos(TodoSource::CodexTodoList, &items).len(), 2);
    }

    #[test]
    fn codex_all_completed_maps_to_all_completed() {
        let items = json!([
            { "text": "Done 1", "completed": true },
            { "text": "Done 2", "completed": true },
        ]);
        let result = normalize_todos(TodoSource::CodexTodoList, &items);
        assert!(result.iter().all(|t| t.status == TodoStatus::Completed));
    }

    #[test]
    fn codex_active_form_matches_content() {
        let items = json!([{ "text": "My task", "completed": false }]);
        let result = normalize_todos(TodoSource::CodexTodoList, &items);
        assert_eq!(result[0].active_form, "My task");
    }
}

// PORT STATUS: src/todos/normalize.ts (117 lines)
// confidence: high
// todos: 0
// notes: normalizeTodos reads raw serde_json::Value (dynamic access mirroring the
// TS `as`-casts). taskV2 accumulates into a Vec<TaskState> + HashMap<id,index>
// (the JS aliased one object into both list and map; the index sidesteps double
// mutable borrows). The `Task #(\d+)` regex → extract_task_number (find + digit
// run). arg_str applies the JS truthy `|| fallback` (present non-empty string).
// todoV1 keeps the string-content/string-status predicate then deserializes into
// the typed TodoItem (invalid status / missing activeForm drops the item — an
// untested divergence from the unchecked JS pass-through). All 21 test assertions
// ported from __tests__/todos-normalize.test.ts.
