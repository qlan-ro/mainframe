#[test]
fn a_nested_append_preserves_tool_call_timing_in_the_settled_group() {
    let mut h = Harness::with_categories(task_categories());
    h.raw.push(assistant(
        "a1",
        vec![tool_use("tb", "Bash"), tool_use("tu1", "Task")],
    ));
    h.step(appended(), None);

    let timing = ToolCallTiming {
        started_at: 1_000,
        completed_at: Some(1_200),
    };
    set_tool_use_timing(&mut h.raw[0].content[0], timing);
    let mut changes = RawChanges::new();
    changes.push(RawChange::Timing("tb".to_string(), Some(timing)));
    h.step(changes, None);

    h.raw.push(user("u2", "thanks"));
    h.step(appended(), None);

    // `append_nested_live`: a subagent child nests into the settled group
    // that owns `tu1`. The in-place patch must not drop `tb`'s timing.
    h.raw[0]
        .content
        .push(tool_use_with_parent("tu2", "Bash", "tu1"));
    let mut changes = RawChanges::new();
    changes.push(RawChange::Nested(0));
    h.step(changes, None);
}

#[test]
fn a_nested_append_preserves_a_backfilled_subject_in_the_settled_group() {
    let mut h = Harness::with_categories(task_categories());
    h.raw.push(assistant(
        "a1",
        vec![tool_use_with_input(
            "tc1",
            "TaskCreate",
            create_input("Ship it"),
        )],
    ));
    h.step(appended(), None);
    h.raw.push(tool_result_msg(
        "r1",
        vec![tool_result("tc1", "Task #1 created successfully: Ship it")],
    ));
    h.step(appended(), None);

    h.raw.push(assistant(
        "a2",
        vec![
            tool_use_with_input("tu1", "TaskUpdate", update_input("1")),
            tool_use("tk", "Task"),
        ],
    ));
    h.step(appended(), None);
    h.raw.push(user("u2", "next"));
    h.step(appended(), None);

    // `append_nested_live`: a subagent child nests into the group holding
    // the backfilled `TaskUpdate`. The in-place patch must not drop the
    // `subject` it inherited from the earlier `TaskCreate`.
    h.raw[2]
        .content
        .push(tool_use_with_parent("child1", "Bash", "tk"));
    let mut changes = RawChanges::new();
    changes.push(RawChange::Nested(2));
    h.step(changes, None);
}

#[test]
fn a_categories_change_forces_a_full_rebuild() {
    let mut h = Harness::new();
    h.raw.push(assistant("a1", vec![tool_use("tu1", "Read")]));
    h.step(appended(), None);
    h.set_categories(task_categories());
    h.step(RawChanges::new(), None);
}
