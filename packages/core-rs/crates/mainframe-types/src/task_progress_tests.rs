use super::*;
use serde_json::json;

#[test]
fn task_result_text_returns_bare_string_as_is() {
    assert_eq!(
        task_result_text(&json!("Task #9 created successfully: Ship it")),
        "Task #9 created successfully: Ship it"
    );
}

#[test]
fn task_result_text_reads_content_field() {
    assert_eq!(
        task_result_text(
            &json!({"content": "Task #9 created successfully: Ship it", "isError": false})
        ),
        "Task #9 created successfully: Ship it"
    );
}

#[test]
fn task_result_text_empty_when_no_content_key() {
    assert_eq!(task_result_text(&json!({"isError": false})), "");
}

#[test]
fn task_result_text_empty_for_non_object_non_string() {
    assert_eq!(task_result_text(&Value::Null), "");
    assert_eq!(task_result_text(&json!(42)), "");
}

#[test]
fn extract_task_id_from_bare_string() {
    assert_eq!(
        extract_task_id(&json!("Task #9 created successfully: Ship it")).as_deref(),
        Some("9")
    );
}

#[test]
fn extract_task_id_from_content_object() {
    assert_eq!(
        extract_task_id(
            &json!({"content": "Task #10 created successfully: Ship it", "isError": false})
        )
        .as_deref(),
        Some("10")
    );
}

#[test]
fn extract_task_id_none_when_absent() {
    assert_eq!(extract_task_id(&Value::Null), None);
    assert_eq!(
        extract_task_id(&json!({"content": "no id here", "isError": false})),
        None
    );
}
