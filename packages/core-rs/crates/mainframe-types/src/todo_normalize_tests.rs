use super::*;
use serde_json::json;

fn todo(content: &str, status: TodoStatus, active_form: &str) -> TodoItem {
    TodoItem {
        content: content.to_string(),
        status,
        active_form: active_form.to_string(),
    }
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
