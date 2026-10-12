#[tokio::test]
async fn excludes_automation_created_chats_from_the_default_list() {
    let ctx = AppCtx::test_ctx();
    let ids = seed(&ctx).await;
    let automated_id = ctx
        .core
        .db
        .call(|db| {
            let p1 = db
                .projects
                .list()?
                .into_iter()
                .find(|p| p.path == "/tmp/p")
                .unwrap()
                .id;
            Ok(db
                .chats
                .create(&mainframe_types::chat::NewChat {
                    project_id: p1,
                    adapter_id: "claude".to_string(),
                    automation_run_id: Some("run-1".to_string()),
                    ..Default::default()
                })?
                .id)
        })
        .await
        .unwrap();

    let got = ids_of(list(State(ctx.clone()), q(None, None, None)).await).await;

    assert!(!got.contains(&automated_id));
    assert_eq!(got, labels(&ids, &["c1", "c2", "c3", "c4", "c5"]));
}
