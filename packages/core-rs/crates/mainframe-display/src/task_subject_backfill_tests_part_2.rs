#[test]
fn coerces_numeric_taskid() {
    let numeric_update = TaskProgressItem {
        timing: None,
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
            images: Vec::new(),
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
