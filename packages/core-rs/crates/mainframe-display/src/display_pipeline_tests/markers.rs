#[test]
fn applies_tool_categories_explore_tool_gets_explore_category() {
    let mut c = 0;
    let messages = vec![
        raw_msg(
            &mut c,
            "assistant",
            vec![tu("tu1", "Read", json!({ "file": "/a.ts" }))],
            json!({}),
        ),
        raw_msg(
            &mut c,
            "tool_result",
            vec![tr("tu1", "content", false)],
            json!({}),
        ),
    ];
    let cats = test_categories();
    let result = prepare_messages_for_client(&messages, Some(&cats));
    let tc = content_json(&result[0])
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["type"] == "tool_call")
        .cloned()
        .unwrap();
    assert_eq!(tc["category"], "explore");
}

#[test]
fn passes_through_permission_messages() {
    let mut c = 0;
    let request = json!({
        "requestId": "req_1",
        "toolName": "Bash",
        "toolUseId": "tu_1",
        "input": { "command": "ls" },
        "suggestions": [],
    });
    let messages = vec![raw_msg(
        &mut c,
        "permission",
        vec![json!({ "type": "permission_request", "request": request })],
        json!({}),
    )];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].r#type, DisplayMessageType::Permission);
    assert_eq!(content_json(&result[0])[0]["type"], "permission_request");
}

#[test]
fn filters_request_interrupted_text_from_user_messages() {
    let mut c = 0;
    let messages = vec![raw_msg(
        &mut c,
        "user",
        vec![txt("fix the bug"), txt("[Request interrupted by user]")],
        json!({}),
    )];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(
        content_json(&result[0]),
        json!([{ "type": "text", "text": "fix the bug" }])
    );
}

#[test]
fn populates_metadata_attached_files_for_file_path_tags() {
    let mut c = 0;
    let messages = vec![raw_msg(
        &mut c,
        "user",
        vec![txt("check this <attached_file_path name=\"foo.ts\"/>")],
        json!({}),
    )];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0]
            .metadata
            .as_ref()
            .and_then(|m| m.get("attachedFiles")),
        Some(&json!([{ "name": "foo.ts" }]))
    );
    assert_eq!(content_json(&result[0])[0]["text"], "check this");
}

#[test]
fn does_not_mutate_original_messages() {
    let mut c = 0;
    let original = raw_msg(
        &mut c,
        "assistant",
        vec![tu("tu1", "Bash", json!({ "command": "ls" }))],
        json!({}),
    );
    let original_before = original.clone();
    let messages = vec![
        original,
        raw_msg(&mut c, "assistant", vec![txt("more")], json!({})),
        raw_msg(
            &mut c,
            "tool_result",
            vec![tr("tu1", "output", false)],
            json!({}),
        ),
        raw_msg(
            &mut c,
            "system",
            vec![],
            json!({ "metadata": { "turnDurationMs": 100 } }),
        ),
    ];
    prepare_messages_for_client(&messages, None);
    assert_eq!(messages[0], original_before);
}

#[test]
fn keeps_thinking_blocks_as_is_in_assistant_messages() {
    let mut c = 0;
    let messages = vec![raw_msg(
        &mut c,
        "assistant",
        vec![
            json!({ "type": "thinking", "thinking": "let me think..." }),
            txt("response"),
        ],
        json!({}),
    )];
    let result = prepare_messages_for_client(&messages, None);
    let content = content_json(&result[0]);
    assert_eq!(
        content[0],
        json!({ "type": "thinking", "thinking": "let me think..." })
    );
    assert_eq!(content[1], json!({ "type": "text", "text": "response" }));
}

#[test]
fn keeps_image_blocks_in_assistant_messages() {
    let mut c = 0;
    let messages = vec![raw_msg(
        &mut c,
        "assistant",
        vec![
            txt("here is your image"),
            json!({ "type": "image", "mediaType": "image/png", "data": "pngbase64" }),
        ],
        json!({}),
    )];
    let result = prepare_messages_for_client(&messages, None);
    let content = content_json(&result[0]);
    assert_eq!(content.as_array().unwrap().len(), 2);
    assert_eq!(
        content[1],
        json!({ "type": "image", "mediaType": "image/png", "data": "pngbase64" })
    );
}

#[test]
fn keeps_image_blocks_in_user_messages() {
    let mut c = 0;
    let messages = vec![raw_msg(
        &mut c,
        "user",
        vec![
            txt("look at this"),
            json!({ "type": "image", "mediaType": "image/png", "data": "base64data" }),
        ],
        json!({}),
    )];
    let result = prepare_messages_for_client(&messages, None);
    let content = content_json(&result[0]);
    assert_eq!(content.as_array().unwrap().len(), 2);
    assert_eq!(
        content[1],
        json!({ "type": "image", "mediaType": "image/png", "data": "base64data" })
    );
}

#[test]
fn suppresses_orphan_tool_result() {
    let mut c = 0;
    let messages = vec![
        raw_msg(&mut c, "user", vec![txt("question")], json!({})),
        raw_msg(
            &mut c,
            "tool_result",
            vec![tr("tu1", "orphan result", false)],
            json!({}),
        ),
    ];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].r#type, DisplayMessageType::User);
}

#[test]
fn suppresses_a_bare_command_name_message_with_no_body() {
    let mut c = 0;
    let messages = vec![
        raw_msg(
            &mut c,
            "user",
            vec![txt("<command-name>do-thing</command-name>")],
            json!({}),
        ),
        raw_msg(&mut c, "assistant", vec![txt("response")], json!({})),
    ];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].r#type, DisplayMessageType::Assistant);
}

#[test]
fn suppresses_a_command_name_with_empty_body_after_stripping() {
    let mut c = 0;
    let messages = vec![raw_msg(
        &mut c,
        "user",
        vec![txt("<command-name>/some-internal-skill</command-name>")],
        json!({}),
    )];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 0);
}
