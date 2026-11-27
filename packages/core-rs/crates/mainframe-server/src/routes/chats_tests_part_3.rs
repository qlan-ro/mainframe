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

#[tokio::test]
async fn subagent_tool_result_reads_the_named_agents_transcript() {
    let ctx = AppCtx::test_ctx();
    let rows: Vec<mainframe_types::chat::ChatMessage> = serde_json::from_value(serde_json::json!([
        {"id":"child-row","chatId":"chat","type":"tool_result","timestamp":"now","content":[
            {"type":"tool_result","toolUseId":"tool_1","content":"child result","isError":false,
            "images":[{"mediaType":"image/png","data":"AAAA"}]}
        ]}
    ]))
    .unwrap();
    let mut adapter = StubAdapter::new("claude", false);
    Arc::get_mut(&mut adapter).unwrap().subagent_rows = Some(Arc::new(rows));
    ctx.core.adapter_registry.register(adapter);
    let id = seed_tool_result_chat(&ctx, "claude").await;
    let query = |agent: &str| {
        Query(crate::routes::tool_images::SubagentQuery {
            agent: Some(agent.into()),
        })
    };

    let (status, body) = read(
        tool_result(
            State(ctx.clone()),
            Path((id.clone(), "tool_1".into())),
            query("worker"),
        )
        .await,
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["content"], "child result");
    let (status, _) = read(
        tool_result(
            State(ctx.clone()),
            Path((id.clone(), "other".into())),
            query("worker"),
        )
        .await,
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = read(
        tool_result(
            State(ctx.clone()),
            Path((id.clone(), "tool_1".into())),
            query("../worker"),
        )
        .await,
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let image = ctx
        .chat
        .chat_manager
        .get_subagent_tool_image(&id, "worker".into(), "tool_1", 0)
        .await
        .unwrap();
    assert_eq!(image.data, "AAAA");
}
