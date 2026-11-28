#[test]
fn places_task_progress_at_the_position_of_the_first_task_tool() {
    let parts = vec![
        tc("Bash", Some("b1")),
        tc("TaskCreate", Some("tc1")),
        tc("Edit", Some("e1")),
        tc("TaskUpdate", Some("tu1")),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 3);
    assert_eq!(tool_name_of(&result[0]), "Bash");
    assert!(matches!(result[1], PartEntry::TaskProgress(_)));
    assert_eq!(tool_name_of(&result[2]), "Edit");
}

#[test]
fn skips_hidden_tools_interspersed_between_explore_tools_when_grouping() {
    let parts = vec![
        tc("Read", Some("r1")),
        tc("TodoWrite", Some("h1")),
        tc("Grep", Some("g1")),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 1);
    assert_eq!(group_item_names(&result[0]), vec!["Read", "Grep"]);
}

#[test]
fn skips_task_progress_tools_interspersed_between_explore_tools_when_grouping() {
    let parts = vec![
        tc("Read", Some("r1")),
        tc("TaskCreate", Some("tc1")),
        tc("Glob", Some("gl1")),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    let tool_group = result
        .iter()
        .find(|p| matches!(p, PartEntry::ToolGroup(_)))
        .expect("expected _tool_group");
    assert_eq!(group_item_names(tool_group), vec!["Read", "Glob"]);
}

#[test]
fn breaks_explore_group_on_a_non_explore_non_hidden_non_task_tool() {
    let parts = vec![
        tc("Read", Some("r1")),
        tc("Bash", Some("b1")),
        tc("Grep", Some("g1")),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 3);
    assert_eq!(tool_name_of(&result[0]), "Read");
    assert_eq!(tool_name_of(&result[1]), "Bash");
    assert_eq!(tool_name_of(&result[2]), "Grep");
}

#[test]
fn breaks_explore_group_on_a_text_entry() {
    let parts = vec![
        tc("Read", Some("r1")),
        text("thinking..."),
        tc("Grep", Some("g1")),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 3);
    assert_eq!(tool_name_of(&result[0]), "Read");
    assert_eq!(result[1], text("thinking..."));
    assert_eq!(tool_name_of(&result[2]), "Grep");
}

#[test]
fn handles_mixed_text_explore_hidden_task_and_normal_tools() {
    let parts = vec![
        text("starting"),
        tc("Read", Some("r1")),
        tc("Grep", Some("g1")),
        tc("TodoWrite", Some("h1")),
        tc("TaskCreate", Some("tc1")),
        tc("Bash", Some("b1")),
        text("done"),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    let names: Vec<String> = result.iter().map(label).collect();
    assert_eq!(
        names,
        vec![
            "text:starting",
            "tool:_TaskProgress",
            "tool:_ToolGroup",
            "tool:Bash",
            "text:done"
        ]
    );
}

#[test]
fn produces_task_progress_when_task_tools_are_not_inside_an_explore_run() {
    let parts = vec![
        tc("TaskCreate", Some("tc1")),
        tc("Bash", Some("b1")),
        tc("TaskUpdate", Some("tu1")),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    let names: Vec<String> = result.iter().map(label).collect();
    assert_eq!(names, vec!["tool:_TaskProgress", "tool:Bash"]);
}

#[test]
fn preserves_tool_call_args_through_grouping() {
    let parts = vec![
        tool_call_custom(
            "r1",
            "Read",
            HashMap::from([("file".to_string(), str_val("/a.ts"))]),
        ),
        tool_call_custom(
            "g1",
            "Grep",
            HashMap::from([("pattern".to_string(), str_val("foo"))]),
        ),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    match &result[0] {
        PartEntry::ToolGroup(e) => {
            assert_eq!(
                e.items[0].args,
                HashMap::from([("file".to_string(), str_val("/a.ts"))])
            );
            assert_eq!(
                e.items[1].args,
                HashMap::from([("pattern".to_string(), str_val("foo"))])
            );
        }
        other => panic!("expected _tool_group, got {other:?}"),
    }
}

#[test]
fn ends_an_explore_run_when_the_next_tool_belongs_to_a_different_parent() {
    let parts = vec![
        tc_tagged("Read", "r1", "t1"),
        tc_tagged("Grep", "g1", "t1"),
        tc("Grep", Some("g2")),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 2);
    match &result[0] {
        PartEntry::ToolGroup(e) => {
            assert_eq!(e.parent_tool_use_id.as_deref(), Some("t1"));
            assert_eq!(group_item_ids(&result[0]), vec!["r1", "g1"]);
        }
        other => panic!("expected _tool_group, got {other:?}"),
    }
    assert_eq!(tool_call_id_of(&result[1]), "g2");
    assert_eq!(result[1].parent_tool_use_id(), None);
}

#[test]
fn keeps_a_main_agent_explore_solo_when_followed_by_a_tagged_subagent_burst() {
    let parts = vec![
        tc("Read", Some("r0")),
        tc_tagged("Read", "r1", "t1"),
        tc_tagged("Grep", "g1", "t1"),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 2);
    assert_eq!(tool_call_id_of(&result[0]), "r0");
    match &result[1] {
        PartEntry::ToolGroup(e) => {
            assert_eq!(e.parent_tool_use_id.as_deref(), Some("t1"));
            assert_eq!(group_item_ids(&result[1]), vec!["r1", "g1"]);
        }
        other => panic!("expected _tool_group, got {other:?}"),
    }
}

#[test]
fn accumulates_task_progress_per_parent_one_tagged_one_untagged() {
    let parts = vec![
        tc("Task", Some("t1")),
        tc_tagged("TaskCreate", "p1", "t1"),
        tc("TaskCreate", Some("p0")),
        tc_tagged("TaskUpdate", "p3", "t1"),
        tc("TaskUpdate", Some("p2")),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 3);
    assert_eq!(tool_name_of(&result[0]), "Task");

    match &result[1] {
        PartEntry::TaskProgress(e) => {
            assert_eq!(e.parent_tool_use_id.as_deref(), Some("t1"));
            assert_eq!(progress_item_ids(&result[1]), vec!["p1", "p3"]);
        }
        other => panic!("expected _task_progress, got {other:?}"),
    }
    match &result[2] {
        PartEntry::TaskProgress(e) => {
            assert_eq!(e.parent_tool_use_id, None);
            assert_eq!(progress_item_ids(&result[2]), vec!["p0", "p2"]);
        }
        other => panic!("expected _task_progress, got {other:?}"),
    }
}

/* ── groupTaskChildren — partitioning ────────────────────────────── */

#[test]
fn routes_interleaved_children_of_parallel_tasks_to_their_own_task_groups() {
    let parts = vec![
        tc("Task", Some("tA")),
        tc("Task", Some("tB")),
        tc_tagged("Bash", "a1", "tA"),
        tc_tagged("Bash", "b1", "tB"),
        tc_tagged("Read", "a2", "tA"),
    ];
    let result = group_task_children(&parts, &claude_cats());
    assert_eq!(result.len(), 2);
    match (&result[0], &result[1]) {
        (PartEntry::TaskGroup(a), PartEntry::TaskGroup(b)) => {
            assert_eq!(a.tool_call_id, "tA");
            assert_eq!(child_ids(&result[0]), vec!["a1", "a2"]);
            assert_eq!(b.tool_call_id, "tB");
            assert_eq!(child_ids(&result[1]), vec!["b1"]);
        }
        other => panic!("expected two _task_group, got {other:?}"),
    }
}
