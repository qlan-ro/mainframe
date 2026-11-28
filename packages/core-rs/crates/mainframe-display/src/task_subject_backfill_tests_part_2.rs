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
    let out = backfill(&messages);
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
    let out = backfill(std::slice::from_ref(&user));
    assert_eq!(out[0], user);
}

#[test]
fn a_task_id_at_the_integer_limit_does_not_overflow_the_next_id() {
    let max = i64::MAX.to_string();
    let messages = vec![
        assistant_msg("m1", vec![create_item(&max, "Last task")]),
        assistant_msg("m2", vec![update_item(&max, "completed", vec![])]),
    ];
    let out = backfill(&messages);
    assert_eq!(
        progress_items(&out[1])[0].input.get("subject"),
        Some(&json!("Last task"))
    );
}

#[test]
fn a_rename_after_a_checkpoint_leaves_the_checkpoint_unchanged() {
    let mut scope = SubjectScope::new();
    backfill_in_place(
        &mut [assistant_msg("m1", vec![create_item("1", "First name")])],
        &mut scope,
    );
    let checkpoint = scope.clone();
    let rename = update_item("1", "in_progress", vec![("subject", json!("Second name"))]);
    backfill_in_place(&mut [assistant_msg("m2", vec![rename])], &mut scope);

    let mut resumed = [assistant_msg("m3", vec![update_item("1", "completed", vec![])])];
    backfill_in_place(&mut resumed, &mut checkpoint.clone());
    assert_eq!(
        progress_items(&resumed[0])[0].input.get("subject"),
        Some(&json!("First name"))
    );
}
