#[tokio::test]
async fn start_reconciles_live_runs_and_reattaches_agent_watches() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("automations.db");
    let creds = dir.path().join("automation-credentials.json");

    // Engine 1 parks the ask_agent step and is then dropped mid-wait.
    let run_id = {
        let sink = Arc::new(CollectingSink::default());
        let engine1 = build_engine(&db_path, &creds, Arc::new(ParkingAgent), sink).await;
        let created = engine1.create(standup_input("Standup")).await.unwrap();
        let run = engine1.run_manually(&created.id).await.unwrap();
        let waiting = wait_for_status(&engine1, &run.id, RunStatus::Waiting).await;
        // The chat id is durably stamped on the checkpoint entry.
        let entry = waiting.checkpoint.steps.get("agent").unwrap();
        assert_eq!(entry.chat_id.as_deref(), Some("chat-parked"));
        run.id
    };

    // Engine 2 adopts the same store: reconcile re-attaches the watch, the
    // agent completes, and the run finishes WITHOUT starting a second chat.
    let sink = Arc::new(CollectingSink::default());
    let agent = Arc::new(AdoptingAgent::default());
    let engine2 = build_engine(&db_path, &creds, agent.clone(), sink).await;
    engine2.start().await.unwrap();

    let done = wait_for_status(&engine2, &run_id, RunStatus::Succeeded).await;
    assert_eq!(done.status, RunStatus::Succeeded);
    assert_eq!(
        agent.start_calls.load(Ordering::SeqCst),
        0,
        "reconcile must re-attach the existing chat, not open a new one"
    );
}
