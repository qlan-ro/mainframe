#[tokio::test]
async fn a_nested_suffix_inside_one_branch_does_not_unlock_a_later_branch_early() {
    // Branch 0 has a nested (sequential) repeat inside it. Walked to its
    // THIRD sub-item, that nested leaf's ref is "agent#0#2" — a naive
    // `ends_with("#2")` check would misread that as branch 2 ("#2") already
    // being outstanding, letting it jump the concurrency:2 budget while
    // branch 1 is still genuinely outstanding.
    let h = harness().await;
    let calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen = calls.clone();
    let ports = FakePorts {
        ask_agent: Box::new(move |_step, ctx: &VerbContext<'_>| {
            seen.lock().unwrap().push(ctx.step_ref.to_string());
            StepOutcome::Wait { wake_at: None }
        }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![concurrent_repeat_step(
        "fanout",
        token_ref("trigger", "items", None),
        2,
        vec![repeat_step(
            "inner",
            token_ref("trigger", "subitems", None),
            vec![ask_agent_step("agent", false)],
        )],
    )]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({
                "items": ["a", "b", "c"],
                "subitems": ["p", "q", "r"],
            })),
            None,
        )
        .await
        .unwrap();

    // Budget of 2: branches 0 and 1 both start; branch 2 stays excluded.
    engine.advance(&run.id).await.unwrap();
    assert_eq!(*calls.lock().unwrap(), vec!["agent#0#0", "agent#1#0"]);

    // Walk branch 0's nested repeat to its third sub-item without ever
    // letting branch 1 settle, so the budget stays fully spent throughout.
    settle_leaf(&h, &run.id, "agent#0#0", StepStatus::Succeeded, None).await;
    engine.advance(&run.id).await.unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        vec!["agent#0#0", "agent#1#0", "agent#0#1"]
    );

    settle_leaf(&h, &run.id, "agent#0#1", StepStatus::Succeeded, None).await;
    engine.advance(&run.id).await.unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        vec!["agent#0#0", "agent#1#0", "agent#0#1", "agent#0#2"]
    );

    // Re-advance without settling anything: branch 1 is still outstanding,
    // so the concurrency:2 budget is spent — branch 2 must not start just
    // because branch 0's nested ref happens to end in "#2".
    engine.advance(&run.id).await.unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        vec!["agent#0#0", "agent#1#0", "agent#0#1", "agent#0#2"],
        "branch 2 must stay excluded while the concurrency:2 budget is spent"
    );
    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Waiting
    );
}
