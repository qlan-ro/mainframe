#[test]
fn renders_an_attachment_only_user_turn_with_empty_content() {
    let mut c = 0;
    let messages = vec![raw_msg(
        &mut c,
        "user",
        vec![],
        json!({ "metadata": { "attachments": [{ "name": "notes.txt", "kind": "file" }] } }),
    )];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].r#type, DisplayMessageType::User);
    assert!(result[0].content.is_empty());
    assert_eq!(
        result[0].metadata.as_ref().unwrap()["attachments"],
        json!([{ "name": "notes.txt", "kind": "file" }])
    );
}

#[test]
fn suppresses_empty_content_with_unrelated_metadata_and_no_attachment_evidence() {
    let mut c = 0;
    let messages = vec![raw_msg(
        &mut c,
        "user",
        vec![txt("<command-name>do-thing</command-name>")],
        json!({ "metadata": { "foo": 1 } }),
    )];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 0);
}

#[test]
fn still_renders_user_typed_skill_name_with_command_message() {
    let mut c = 0;
    let messages = vec![
        raw_msg(
            &mut c,
            "user",
            vec![txt(
                "<command-message>systematic-debugging</command-message>\n<command-name>/systematic-debugging</command-name>",
            )],
            json!({}),
        ),
        raw_msg(&mut c, "assistant", vec![txt("response")], json!({})),
    ];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].r#type, DisplayMessageType::User);
    assert_eq!(
        content_json(&result[0]),
        json!([{ "type": "text", "text": "/systematic-debugging" }])
    );
}

#[test]
fn still_renders_user_typed_skill_name_args_bubble_when_command_message_present() {
    let mut c = 0;
    let messages = vec![raw_msg(
        &mut c,
        "user",
        vec![txt(
            "<command-message>brainstorming</command-message>\n<command-name>/brainstorming</command-name>\n<command-args>new feature idea</command-args>",
        )],
        json!({}),
    )];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].r#type, DisplayMessageType::User);
    assert_eq!(
        content_json(&result[0]),
        json!([{ "type": "text", "text": "/brainstorming new feature idea" }])
    );
}

#[test]
fn groups_consecutive_explore_tools_into_a_tool_group() {
    let mut c = 0;
    let messages = vec![
        raw_msg(
            &mut c,
            "assistant",
            vec![
                tu("tu1", "Read", json!({ "file": "/a.ts" })),
                tu("tu2", "Grep", json!({ "pattern": "foo" })),
                tu("tu3", "Glob", json!({ "pattern": "*.ts" })),
            ],
            json!({}),
        ),
        raw_msg(
            &mut c,
            "tool_result",
            vec![
                tr("tu1", "a-content", false),
                tr("tu2", "grep-result", false),
                tr("tu3", "glob-result", false),
            ],
            json!({}),
        ),
    ];
    let cats = test_categories();
    let result = prepare_messages_for_client(&messages, Some(&cats));
    let groups = content_json(&result[0])
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["type"] == "tool_group")
        .count();
    assert_eq!(groups, 1);
}

#[test]
fn wraps_subagent_tool_plus_tagged_children_into_a_task_group() {
    let mut c = 0;
    let messages = vec![
        raw_msg(
            &mut c,
            "assistant",
            vec![
                tu("tu1", "Task", json!({ "description": "do something" })),
                json!({ "type": "tool_use", "id": "tu2", "name": "Bash", "input": { "command": "ls" }, "parentToolUseId": "tu1" }),
            ],
            json!({}),
        ),
        raw_msg(
            &mut c,
            "tool_result",
            vec![
                tr("tu1", "task-result", false),
                tr("tu2", "bash-result", false),
            ],
            json!({}),
        ),
    ];
    let cats = test_categories();
    let result = prepare_messages_for_client(&messages, Some(&cats));
    let task_groups = content_json(&result[0])
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["type"] == "task_group")
        .count();
    assert_eq!(task_groups, 1);
}

#[test]
fn preserves_thinking_block_position_among_grouped_tool_calls() {
    let mut c = 0;
    let messages = vec![
        raw_msg(
            &mut c,
            "assistant",
            vec![
                txt("Let me think"),
                json!({ "type": "thinking", "thinking": "reasoning here" }),
                tu("tu1", "Read", json!({ "file_path": "a.ts" })),
                tu("tu2", "Read", json!({ "file_path": "b.ts" })),
                tu("tu3", "Bash", json!({ "command": "ls" })),
            ],
            json!({}),
        ),
        raw_msg(
            &mut c,
            "tool_result",
            vec![
                tr("tu1", "content-a", false),
                tr("tu2", "content-b", false),
                tr("tu3", "ls-output", false),
            ],
            json!({}),
        ),
    ];
    let cats = test_categories();
    let result = prepare_messages_for_client(&messages, Some(&cats));
    let content = content_json(&result[0]);
    let types: Vec<String> = content
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["type"].as_str().unwrap().to_string())
        .collect();
    let thinking_idx = types.iter().position(|t| t == "thinking").unwrap();
    let text_idx = types.iter().position(|t| t == "text").unwrap();
    assert!(thinking_idx > text_idx);
    assert_ne!(thinking_idx, 0);
}
