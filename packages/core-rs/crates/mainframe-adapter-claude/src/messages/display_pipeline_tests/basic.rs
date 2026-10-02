#[test]
fn returns_empty_array_for_empty_input() {
    assert!(prepare_messages_for_client(&[], None).is_empty());
}

#[test]
fn converts_a_single_user_text_message() {
    let mut c = 0;
    let messages = vec![raw_msg(&mut c, "user", vec![txt("hello")], json!({}))];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].r#type, DisplayMessageType::User);
    assert_eq!(
        content_json(&result[0]),
        json!([{ "type": "text", "text": "hello" }])
    );
}

#[test]
fn converts_a_single_assistant_text_message() {
    let mut c = 0;
    let messages = vec![raw_msg(
        &mut c,
        "assistant",
        vec![txt("hi there")],
        json!({}),
    )];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].r#type, DisplayMessageType::Assistant);
    assert_eq!(
        content_json(&result[0]),
        json!([{ "type": "text", "text": "hi there" }])
    );
}

#[test]
fn converts_assistant_tool_use_plus_tool_result_into_tool_call_with_result() {
    let mut c = 0;
    let messages = vec![
        raw_msg(
            &mut c,
            "assistant",
            vec![
                txt("Let me check"),
                tu("tu1", "Bash", json!({ "command": "ls" })),
            ],
            json!({}),
        ),
        raw_msg(
            &mut c,
            "tool_result",
            vec![tr("tu1", "file.ts\nindex.ts", false)],
            json!({}),
        ),
    ];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].r#type, DisplayMessageType::Assistant);
    let content = content_json(&result[0]);
    assert_eq!(content.as_array().unwrap().len(), 2);
    assert_eq!(
        content[0],
        json!({ "type": "text", "text": "Let me check" })
    );
    assert_eq!(content[1]["type"], "tool_call");
    assert_eq!(content[1]["id"], "tu1");
    assert_eq!(content[1]["name"], "Bash");
    assert_eq!(content[1]["input"], json!({ "command": "ls" }));
    assert_eq!(content[1]["category"], "default");
    assert_eq!(
        content[1]["result"],
        json!({ "content": "file.ts\nindex.ts", "isError": false })
    );
}

#[test]
fn merges_consecutive_assistant_messages_into_one_turn() {
    let mut c = 0;
    let messages = vec![
        raw_msg(&mut c, "assistant", vec![txt("part 1")], json!({})),
        raw_msg(&mut c, "assistant", vec![txt("part 2")], json!({})),
    ];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(
        content_json(&result[0]),
        json!([{ "type": "text", "text": "part 1" }, { "type": "text", "text": "part 2" }])
    );
}

#[test]
fn strips_mainframe_command_response_tags_from_assistant_text() {
    let mut c = 0;
    let messages = vec![raw_msg(
        &mut c,
        "assistant",
        vec![txt(
            "<mainframe-command-response id=\"x\">inner content</mainframe-command-response>",
        )],
        json!({}),
    )];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(
        content_json(&result[0])[0],
        json!({ "type": "text", "text": "inner content" })
    );
}

#[test]
fn filters_out_internal_user_messages_with_mainframe_command() {
    let mut c = 0;
    let messages = vec![
        raw_msg(
            &mut c,
            "user",
            vec![txt(
                "<mainframe-command type=\"status\">check</mainframe-command>",
            )],
            json!({}),
        ),
        raw_msg(&mut c, "assistant", vec![txt("response")], json!({})),
    ];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].r#type, DisplayMessageType::Assistant);
}

#[test]
fn renders_user_typed_slash_skill_name_as_a_bubble() {
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
fn renders_user_typed_slash_skill_name_with_args() {
    let mut c = 0;
    let messages = vec![raw_msg(
        &mut c,
        "user",
        vec![txt(
            "<command-message>work-logger:slack-status-writer</command-message>\n<command-name>/work-logger:slack-status-writer</command-name>\n<command-args>how are you</command-args>",
        )],
        json!({}),
    )];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].r#type, DisplayMessageType::User);
    assert_eq!(
        content_json(&result[0]),
        json!([{ "type": "text", "text": "/work-logger:slack-status-writer how are you" }])
    );
}

#[test]
fn deduplicates_tool_use_blocks_by_id() {
    let mut c = 0;
    let messages = vec![raw_msg(
        &mut c,
        "assistant",
        vec![
            tu("tu1", "Bash", json!({ "command": "ls" })),
            tu("tu1", "Bash", json!({ "command": "ls" })),
            tu("tu2", "Read", json!({ "file": "/a.ts" })),
        ],
        json!({}),
    )];
    let result = prepare_messages_for_client(&messages, None);
    let tool_calls = content_json(&result[0])
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["type"] == "tool_call")
        .count();
    assert_eq!(tool_calls, 2);
}

#[test]
fn passes_through_system_compact_boundary() {
    let mut c = 0;
    let messages = vec![raw_msg(
        &mut c,
        "system",
        vec![txt("[compact_boundary]")],
        json!({}),
    )];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].r#type, DisplayMessageType::System);
    assert_eq!(
        content_json(&result[0]),
        json!([{ "type": "text", "text": "[compact_boundary]" }])
    );
}

#[test]
fn deduplicates_messages_with_the_same_id() {
    let mut c = 0;
    let messages = vec![
        raw_msg(&mut c, "user", vec![txt("hello")], json!({})),
        raw_msg(&mut c, "assistant", vec![txt("hi")], json!({})),
        raw_msg(
            &mut c,
            "system",
            vec![txt("Context compacted")],
            json!({ "id": "dup-id" }),
        ),
        raw_msg(&mut c, "user", vec![txt("more")], json!({})),
        raw_msg(
            &mut c,
            "system",
            vec![txt("Context compacted")],
            json!({ "id": "dup-id" }),
        ),
    ];
    let result = prepare_messages_for_client(&messages, None);
    let system_msgs = result
        .iter()
        .filter(|m| m.r#type == DisplayMessageType::System)
        .count();
    assert_eq!(system_msgs, 1);
    assert_eq!(result.len(), 4);
}

#[test]
fn passes_through_error_messages() {
    let mut c = 0;
    let messages = vec![raw_msg(
        &mut c,
        "error",
        vec![json!({ "type": "error", "message": "something broke" })],
        json!({}),
    )];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].r#type, DisplayMessageType::Error);
    assert_eq!(
        content_json(&result[0]),
        json!([{ "type": "error", "message": "something broke" }])
    );
}

#[test]
fn attaches_turn_duration_ms_to_preceding_assistant() {
    let mut c = 0;
    let messages = vec![
        raw_msg(&mut c, "assistant", vec![txt("answer")], json!({})),
        raw_msg(
            &mut c,
            "system",
            vec![],
            json!({ "metadata": { "turnDurationMs": 1234 } }),
        ),
    ];
    let result = prepare_messages_for_client(&messages, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].r#type, DisplayMessageType::Assistant);
    assert_eq!(
        result[0]
            .metadata
            .as_ref()
            .and_then(|m| m.get("turnDurationMs")),
        Some(&json!(1234))
    );
}
