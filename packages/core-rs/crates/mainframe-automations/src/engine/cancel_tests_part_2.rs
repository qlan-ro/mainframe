#[tokio::test]
async fn cancelled_run_plus_agent_port_completion_never_resurrects() {
    use super::agent_test_support::agent_rig;
    use crate::ports::AgentOutcome;

    let notify_calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let notified = notify_calls.clone();
    let rig = agent_rig(FakePorts {
        notify: Box::new(move |step, _| {
            notified.lock().unwrap().push(step.id.clone());
            completed(empty_outputs())
        }),
        ..FakePorts::default()
    })
    .await;
    let def = definition(vec![
        ask_agent_step("agent-1", false),
        notify_step("notify-1", vec![text("should never run")]),
    ]);
    let run = rig
        .engine
        .start_run(&rig.h.automation_id, def, manual(), None)
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();
    assert_eq!(
        rig.h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Waiting
    );

    rig.engine.cancel_run(&run.id).await.unwrap();

    tokio::time::timeout(std::time::Duration::from_secs(10), rig.port.wait_for_cancel("chat-1")).await.unwrap();
    assert_eq!(
        *rig.port.cancels.lock().unwrap(),
        vec!["chat-1".to_string()]
    );

    // The chat completes anyway: the wait is gone, so nothing settles.
    rig.port.complete(
        "chat-1",
        Ok(AgentOutcome::Completed {
            final_text: "too late".to_string(),
        }),
    );
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        rig._verb.wait_for_watcher("chat-1"),
    )
    .await
    .unwrap().unwrap();

    let finished = rig.h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Cancelled);
    assert_eq!(
        finished.checkpoint.steps["agent-1"].status,
        StepStatus::Waiting
    );
    assert!(finished.checkpoint.steps["agent-1"].outputs.is_none());
    assert!(notify_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_late_agent_completion_cannot_resurrect_a_cancelled_run() {
    let h = harness().await;
    let waits = Arc::new(StubWaits::default());
    let register = waits.clone();
    let notify_calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let notified = notify_calls.clone();
    let ports = FakePorts {
        ask_agent: Box::new(move |_, ctx| {
            register.waits.lock().unwrap().insert(
                "chat-1".to_string(),
                (ctx.run_id.to_string(), ctx.step_ref.to_string()),
            );
            StepOutcome::Wait { wake_at: None }
        }),
        notify: Box::new(move |step, _| {
            notified.lock().unwrap().push(step.id.clone());
            completed(empty_outputs())
        }),
        ..FakePorts::default()
    };
    let mut deps = h.deps(ports);
    deps.agent_waits = Some(waits.clone());
    let engine = Interpreter::new(deps);
    let def = definition(vec![
        ask_agent_step("agent-1", false),
        notify_step("notify-1", vec![text("should never run")]),
    ]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();
    assert_eq!(waits.find_by_run(&run.id).as_deref(), Some("chat-1"));

    engine.cancel_run(&run.id).await.unwrap();

    // The wait registration is gone, in the same cancel pass.
    assert!(waits.find_by_run(&run.id).is_none());
    assert_eq!(*waits.cleared.lock().unwrap(), vec![run.id.clone()]);

    // A waker that somehow still tried anyway: the checkpoint write is
    // rejected (A8) and a re-advance is a no-op.
    let write = h
        .store
        .patch_checkpoint(&run.id, |cp| {
            if let Some(entry) = cp.steps.get_mut("agent-1") {
                entry.status = StepStatus::Succeeded;
            }
        })
        .await;
    assert!(matches!(write, Err(StoreError::TerminalRun { .. })));
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Cancelled);
    assert_eq!(
        finished.checkpoint.steps["agent-1"].status,
        StepStatus::Waiting
    );
    assert!(notify_calls.lock().unwrap().is_empty());
}
