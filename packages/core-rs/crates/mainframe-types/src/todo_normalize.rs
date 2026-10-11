use std::collections::HashMap;

use crate::chat::{TodoItem, TodoStatus};
use serde_json::Value;

/// The three sources that can produce a TodoItem list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TodoSource {
    TaskV2,
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
        TodoSource::TaskV2 => normalize_task_v2(payload),
    }
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

#[cfg(test)]
#[path = "todo_normalize_tests.rs"]
mod tests;
