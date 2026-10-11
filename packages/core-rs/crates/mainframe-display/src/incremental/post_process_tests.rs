use super::*;
use mainframe_types::display::{
    DisplayContent, DisplayMessage, DisplayMessageType, TaskProgressItem, ToolCategory,
};
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
    let mut scope = crate::task_subject_backfill::scope_after(&[task_group(
        "seed",
        vec![create_item("1", "Seeded task")],
    )
    .display
    .unwrap()]);
    let mut groups = vec![task_group("tail", vec![update_item("1")])];
    let mut scope_before = Vec::new();
    backfill_tail(&mut groups, 0, &mut scope, &mut scope_before);
    assert_eq!(
        progress_items(&groups[0])[0].input.get("subject"),
        Some(&json!("Seeded task"))
    );
}
