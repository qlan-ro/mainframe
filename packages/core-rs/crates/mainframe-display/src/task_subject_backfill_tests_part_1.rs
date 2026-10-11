use super::*;
use mainframe_types::display::{ToolCallResult, ToolCategory};
use serde_json::json;

fn create_item(id: &str, subject: &str) -> TaskProgressItem {
    TaskProgressItem {
        timing: None,
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
            images: Vec::new(),
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
        timing: None,
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
            images: Vec::new(),
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
        timing: None,
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
        timing: None,
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
        timing: None,
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
