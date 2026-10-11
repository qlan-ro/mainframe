#[test]
fn keeps_an_answered_default_ask_user_question_part() {
    let out = group_tool_call_parts(
        &[tool_call_cat("a", "AskUserQuestion", Some("default"))],
        &auq_cats(),
    );
    assert!(out.iter().any(|p| matches!(
        p,
        PartEntry::ToolCall { tool_call_id, .. } if tool_call_id == "a"
    )));
}

#[test]
fn drops_a_pending_hidden_ask_user_question_part() {
    let out = group_tool_call_parts(
        &[tool_call_cat("b", "AskUserQuestion", Some("hidden"))],
        &auq_cats(),
    );
    assert!(!out.iter().any(|p| matches!(
        p,
        PartEntry::ToolCall { tool_call_id, .. } if tool_call_id == "b"
    )));
}

/* ── hidden-call paragraph boundary ──────────────────────────────── */

fn text_tagged(t: &str, parent: &str) -> PartEntry {
    PartEntry::Text {
        text: t.to_string(),
        parent_tool_use_id: Some(parent.to_string()),
    }
}

fn passthrough_thinking(t: &str) -> PartEntry {
    PartEntry::Passthrough {
        content: DisplayContent::Leaf(LeafContent::Thinking {
            thinking: t.to_string(),
            parent_tool_use_id: None,
        }),
        parent_tool_use_id: None,
    }
}

fn passthrough_image() -> PartEntry {
    PartEntry::Passthrough {
        content: DisplayContent::Leaf(LeafContent::Image {
            media_type: "image/png".to_string(),
            data: "...".to_string(),
            parent_tool_use_id: None,
        }),
        parent_tool_use_id: None,
    }
}

fn text_of(p: &PartEntry) -> &str {
    match p {
        PartEntry::Text { text, .. } => text,
        other => panic!("expected Text, got {other:?}"),
    }
}

#[test]
fn ordinary_adjacent_text_with_no_hidden_call_is_unmodified() {
    let parts = vec![text("first"), text("second")];
    assert_eq!(
        group_tool_call_parts(&parts, &claude_cats()),
        vec![text("first"), text("second")]
    );
}

#[test]
fn hidden_call_between_texts_inserts_a_blank_line() {
    let parts = vec![
        text("first"),
        tc("TodoWrite", Some("h1"), None, None),
        text("second"),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 2);
    assert_eq!(text_of(&result[0]), "first");
    assert_eq!(text_of(&result[1]), "\n\nsecond");
}

#[test]
fn existing_blank_line_on_the_tail_is_not_doubled() {
    let parts = vec![
        text("first\n\n"),
        tc("TodoWrite", Some("h1"), None, None),
        text("second"),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(text_of(&result[1]), "second");
}

#[test]
fn a_single_trailing_newline_on_the_tail_is_topped_up_to_two() {
    let parts = vec![
        text("first\n"),
        tc("TodoWrite", Some("h1"), None, None),
        text("second"),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(text_of(&result[1]), "\nsecond");
}

#[test]
fn a_single_leading_newline_on_the_incoming_text_is_topped_up_to_two() {
    let parts = vec![
        text("first"),
        tc("TodoWrite", Some("h1"), None, None),
        text("\nsecond"),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(text_of(&result[1]), "\n\nsecond");
}

#[test]
fn two_hidden_calls_in_a_row_produce_one_boundary() {
    let parts = vec![
        text("first"),
        tc("TodoWrite", Some("h1"), None, None),
        tc("AskUserQuestion", Some("h2"), None, None),
        text("second"),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 2);
    assert_eq!(text_of(&result[1]), "\n\nsecond");
}

#[test]
fn a_leading_hidden_call_with_no_tail_text_adds_no_separator() {
    let parts = vec![tc("TodoWrite", Some("h1"), None, None), text("second")];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result, vec![text("second")]);
}

#[test]
fn a_trailing_hidden_call_with_no_following_text_adds_no_separator() {
    let parts = vec![text("first"), tc("TodoWrite", Some("h1"), None, None)];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result, vec![text("first")]);
}

#[test]
fn a_passthrough_image_between_hidden_and_text_clears_the_boundary() {
    let parts = vec![
        text("first"),
        tc("TodoWrite", Some("h1"), None, None),
        passthrough_image(),
        text("second"),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 3);
    assert_eq!(text_of(&result[0]), "first");
    assert_eq!(text_of(&result[2]), "second");
}

#[test]
fn a_passthrough_thinking_between_hidden_and_text_clears_the_boundary() {
    let parts = vec![
        text("first"),
        tc("TodoWrite", Some("h1"), None, None),
        passthrough_thinking("hmm"),
        text("second"),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 3);
    assert_eq!(text_of(&result[0]), "first");
    assert_eq!(text_of(&result[2]), "second");
}

#[test]
fn a_spliced_task_progress_entry_between_the_texts_suppresses_the_break() {
    let parts = vec![
        text("first"),
        tc("TaskCreate", Some("tc1"), None, None),
        tc("TodoWrite", Some("h1"), None, None),
        text("second"),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    let labels: Vec<String> = result.iter().map(label).collect();
    assert_eq!(
        labels,
        vec!["text:first", "tool:_TaskProgress", "text:second"]
    );
}

#[test]
fn a_hidden_call_from_a_different_parent_adds_no_break() {
    let parts = vec![
        text("first"),
        tc_tagged("TodoWrite", "h1", "sub1", None),
        text("second"),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result, vec![text("first"), text("second")]);
}

#[test]
fn a_hidden_call_matching_the_subagent_texts_parent_gets_the_break() {
    let parts = vec![
        text_tagged("first", "sub1"),
        tc_tagged("TodoWrite", "h1", "sub1", None),
        text_tagged("second", "sub1"),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 2);
    assert_eq!(text_of(&result[0]), "first");
    assert_eq!(text_of(&result[1]), "\n\nsecond");
}

#[test]
fn the_subagent_break_survives_nesting_into_the_task_group() {
    let task_id = "t-agent";
    let tagged = vec![
        text_tagged("first", task_id),
        tc_tagged("TodoWrite", "h1", task_id, None),
        text_tagged("second", task_id),
    ];
    let grouped = group_tool_call_parts(&tagged, &claude_cats());
    assert_eq!(grouped.len(), 2);
    assert_eq!(text_of(&grouped[1]), "\n\nsecond");

    let mut parts = vec![tc("Task", Some(task_id), None, None)];
    parts.extend(grouped);
    let result = group_task_children(&parts, &claude_cats());
    assert_eq!(result.len(), 1);
    match &result[0] {
        PartEntry::TaskGroup(e) => {
            assert_eq!(e.children.len(), 2);
            assert_eq!(text_of(&e.children[0]), "first");
            assert_eq!(text_of(&e.children[1]), "\n\nsecond");
        }
        other => panic!("expected _task_group, got {other:?}"),
    }
}
