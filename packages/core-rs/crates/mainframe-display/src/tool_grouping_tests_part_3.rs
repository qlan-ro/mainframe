#[test]
fn groups_children_that_arrive_after_an_untagged_main_tool_in_the_same_turn() {
    let parts = vec![
        tc("Task", Some("t1"), None, None),
        tc("Bash", Some("m1"), None, None),
        tc_tagged("Bash", "c1", "t1", None),
        tc_tagged("Read", "c2", "t1", None),
    ];
    let result = group_task_children(&parts, &claude_cats());
    assert_eq!(result.len(), 2);
    match &result[0] {
        PartEntry::TaskGroup(e) => {
            assert_eq!(e.tool_call_id, "t1");
            assert_eq!(child_ids(&result[0]), vec!["c1", "c2"]);
        }
        other => panic!("expected _task_group, got {other:?}"),
    }
    assert_eq!(tool_call_id_of(&result[1]), "m1");
}

#[test]
fn drops_parts_tagged_with_an_unknown_parent_id() {
    let parts = vec![
        tc("Task", Some("t1"), None, None),
        tc_tagged("Bash", "c1", "t1", None),
        tc_tagged("Bash", "x1", "toolu_unknown", None),
    ];
    let result = group_task_children(&parts, &claude_cats());
    assert_eq!(result.len(), 1);
    assert_eq!(child_ids(&result[0]), vec!["c1"]);
}

/* ── with empty categories (no grouping) ─────────────────────────── */

#[test]
fn passes_all_tool_calls_through_ungrouped_with_empty_categories() {
    let parts = vec![
        tc("Read", Some("r1"), None, None),
        tc("Grep", Some("g1"), None, None),
        tc("TodoWrite", Some("h1"), None, None),
    ];
    let result = group_tool_call_parts(&parts, &empty_cats());
    assert_eq!(result.len(), 3);
}

#[test]
fn does_not_create_task_group_entries_with_empty_categories() {
    let parts = vec![
        tc("Task", Some("t1"), None, None),
        tc("Bash", Some("b1"), None, None),
    ];
    let result = group_task_children(&parts, &empty_cats());
    assert_eq!(result.len(), 2);
    assert_eq!(tool_name_of(&result[0]), "Task");
}

/* ── groupTaskChildren ───────────────────────────────────────────── */

#[test]
fn group_task_children_returns_empty_array_for_empty_input() {
    assert_eq!(group_task_children(&[], &claude_cats()), vec![]);
}

#[test]
fn passes_through_parts_with_no_task_tool_call() {
    let parts = vec![
        text("hello"),
        tc("Bash", Some("b1"), None, None),
        text("done"),
    ];
    let result = group_task_children(&parts, &claude_cats());
    assert_eq!(result, parts);
}

#[test]
fn wraps_a_task_plus_tagged_subsequent_tool_calls_into_a_task_group() {
    let parts = vec![
        tc("Task", Some("t1"), None, None),
        tc_tagged("Bash", "b1", "t1", Some(str_val("output"))),
        tc_tagged("Read", "r1", "t1", Some(str_val("file"))),
    ];
    let result = group_task_children(&parts, &claude_cats());
    assert_eq!(result.len(), 1);
    match &result[0] {
        PartEntry::TaskGroup(e) => {
            assert_eq!(e.tool_call_id, "t1");
            assert_eq!(e.children.len(), 2);
            assert_eq!(
                e.children[0],
                tc_tagged("Bash", "b1", "t1", Some(str_val("output")))
            );
            assert_eq!(
                e.children[1],
                tc_tagged("Read", "r1", "t1", Some(str_val("file")))
            );
        }
        other => panic!("expected _task_group, got {other:?}"),
    }
}

#[test]
fn preserves_task_args_in_task_args() {
    let parts = vec![
        tool_call_custom(
            "t1",
            "Task",
            HashMap::from([("description".to_string(), str_val("do stuff"))]),
            None,
            None,
        ),
        tc_tagged("Bash", "b1", "t1", None),
    ];
    let result = group_task_children(&parts, &claude_cats());
    match &result[0] {
        PartEntry::TaskGroup(e) => {
            assert_eq!(
                e.task_args,
                HashMap::from([("description".to_string(), str_val("do stuff"))])
            );
        }
        other => panic!("expected _task_group, got {other:?}"),
    }
}

#[test]
fn keeps_untagged_entries_top_level_alongside_the_task_group() {
    let parts = vec![
        tc("Task", Some("t1"), None, None),
        tc_tagged("Bash", "b1", "t1", None),
        text("middle"),
        tc("Edit", Some("e1"), None, None),
    ];
    let result = group_task_children(&parts, &claude_cats());
    assert_eq!(result.len(), 3);
    match &result[0] {
        PartEntry::TaskGroup(e) => {
            assert_eq!(e.children.len(), 1);
            assert_eq!(e.children[0], tc_tagged("Bash", "b1", "t1", None));
        }
        other => panic!("expected _task_group, got {other:?}"),
    }
    assert_eq!(result[1], text("middle"));
    assert_eq!(tool_name_of(&result[2]), "Edit");
}

#[test]
fn routes_children_tagged_for_different_parents_to_their_own_task_groups() {
    let parts = vec![
        tc("Task", Some("t1"), None, None),
        tc_tagged("Bash", "b1", "t1", None),
        tc("Task", Some("t2"), None, None),
        tc_tagged("Read", "r1", "t2", None),
    ];
    let result = group_task_children(&parts, &claude_cats());
    assert_eq!(result.len(), 2);
    match (&result[0], &result[1]) {
        (PartEntry::TaskGroup(g1), PartEntry::TaskGroup(g2)) => {
            assert_eq!(g1.tool_call_id, "t1");
            assert_eq!(g2.tool_call_id, "t2");
            assert_eq!(g1.children.len(), 1);
            assert_eq!(g1.children[0], tc_tagged("Bash", "b1", "t1", None));
            assert_eq!(g2.children.len(), 1);
            assert_eq!(g2.children[0], tc_tagged("Read", "r1", "t2", None));
        }
        other => panic!("expected two _task_group, got {other:?}"),
    }
}

#[test]
fn a_task_with_no_children_still_emits_an_empty_task_group() {
    let parts = vec![tc("Task", Some("t1"), None, None), text("after")];
    let result = group_task_children(&parts, &claude_cats());
    assert_eq!(result.len(), 2);
    match &result[0] {
        PartEntry::TaskGroup(e) => {
            assert_eq!(e.tool_call_id, "t1");
            assert!(e.children.is_empty());
        }
        other => panic!("expected _task_group, got {other:?}"),
    }
    assert_eq!(result[1], text("after"));
}

#[test]
fn a_trailing_task_with_no_children_still_emits_an_empty_task_group() {
    let parts = vec![text("before"), tc("Task", Some("t1"), None, None)];
    let result = group_task_children(&parts, &claude_cats());
    assert_eq!(result.len(), 2);
    assert_eq!(result[0], text("before"));
    match &result[1] {
        PartEntry::TaskGroup(e) => {
            assert_eq!(e.tool_call_id, "t1");
            assert!(e.children.is_empty());
        }
        other => panic!("expected _task_group, got {other:?}"),
    }
}

#[test]
fn preserves_result_and_is_error_on_task_group() {
    let parts = vec![
        tool_call_custom(
            "t1",
            "Task",
            HashMap::new(),
            Some(str_val("task done")),
            Some(false),
        ),
        tc_tagged("Bash", "b1", "t1", None),
    ];
    let result = group_task_children(&parts, &claude_cats());
    match &result[0] {
        PartEntry::TaskGroup(e) => {
            assert_eq!(e.result, Some(str_val("task done")));
            assert_eq!(e.is_error, Some(false));
        }
        other => panic!("expected _task_group, got {other:?}"),
    }
}

#[test]
fn nests_a_tagged_tool_group_inside_the_parent_task_group() {
    let task_id = "t-agent";
    let explore_items = vec![
        tc_tagged("Read", "r1", task_id, None),
        tc_tagged("Grep", "g1", task_id, None),
        tc_tagged("Glob", "gl1", task_id, None),
    ];
    let grouped = group_tool_call_parts(&explore_items, &claude_cats());
    assert_eq!(grouped.len(), 1);
    assert!(matches!(grouped[0], PartEntry::ToolGroup(_)));

    let mut parts = vec![tc("Task", Some(task_id), None, None)];
    parts.extend(grouped);
    let result = group_task_children(&parts, &claude_cats());
    assert_eq!(result.len(), 1);
    match &result[0] {
        PartEntry::TaskGroup(e) => {
            assert_eq!(e.children.len(), 1);
            assert!(matches!(e.children[0], PartEntry::ToolGroup(_)));
        }
        other => panic!("expected _task_group, got {other:?}"),
    }
}

/* ── AskUserQuestion ───────────────────────────────────────────────── */

fn auq_cats() -> ToolCategories {
    ToolCategories {
        explore: HashSet::new(),
        hidden: HashSet::from(["AskUserQuestion".to_string()]),
        progress: HashSet::new(),
        subagent: HashSet::new(),
    }
}

fn tool_call_cat(id: &str, name: &str, category: Option<&str>) -> PartEntry {
    PartEntry::ToolCall {
        tool_call_id: id.to_string(),
        tool_name: name.to_string(),
        args: HashMap::new(),
        result: None,
        is_error: None,
        category: category.map(str::to_string),
        parent_tool_use_id: None,
    }
}
