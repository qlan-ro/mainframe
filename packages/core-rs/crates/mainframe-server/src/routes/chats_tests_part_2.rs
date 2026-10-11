async fn seed_tool_result_chat(ctx: &Arc<AppCtx>, adapter_id: &str) -> String {
    let adapter_id = adapter_id.to_string();
    ctx.core
        .db
        .call(move |db| {
            let project = db.projects.create("/tmp/tool-result-project", None)?;
            let chat = db.chats.create(&mainframe_types::chat::NewChat {
                project_id: project.id,
                adapter_id,
                ..Default::default()
            })?;
            db.chats.update(
                &chat.id,
                &ChatPatch {
                    vendor_session_id: Some("session-1".into()),
                    ..Default::default()
                },
            )?;
            Ok(chat.id)
        })
        .await
        .unwrap()
}

#[tokio::test]
async fn codex_tool_result_without_path_uses_adapter_rollout_and_persists_it() {
    let ctx = AppCtx::test_ctx();
    let dir = tempfile::tempdir().unwrap();
    let rollout = dir.path().join("rollout.jsonl");
    std::fs::write(&rollout, r#"{"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"call_1","output":"codex result"}}"#).unwrap();
    let mut adapter = StubAdapter::new("codex", false);
    Arc::get_mut(&mut adapter).unwrap().tool_reader =
        Some(Arc::new(mainframe_adapter_codex::CodexAdapter::default()));
    Arc::get_mut(&mut adapter).unwrap().transcript_location = Some(TranscriptLocation::Present(
        rollout.to_string_lossy().into_owned(),
    ));
    ctx.core.adapter_registry.register(adapter);
    let id = seed_tool_result_chat(&ctx, "codex").await;

    let (status, body) =
        read(tool_result(State(ctx.clone()), Path((id.clone(), "call_1".into()))).await)
            .await
            .unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["content"], "codex result");
    let stored = ctx
        .core
        .db
        .call(move |db| db.chats.get(&id))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.session_file_path.as_deref(), rollout.to_str());
}

#[tokio::test]
async fn codex_tool_result_without_transcript_keeps_path_absent() {
    let ctx = AppCtx::test_ctx();
    ctx.core
        .adapter_registry
        .register(StubAdapter::new("codex", false));
    let id = seed_tool_result_chat(&ctx, "codex").await;

    let (status, body) =
        read(tool_result(State(ctx.clone()), Path((id.clone(), "call_1".into()))).await)
            .await
            .unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "No session file for chat");
    let stored = ctx
        .core
        .db
        .call(move |db| db.chats.get(&id))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.session_file_path, None);
}

#[tokio::test]
async fn claude_tool_result_without_path_uses_adapter_jsonl() {
    let ctx = AppCtx::test_ctx();
    let dir = tempfile::tempdir().unwrap();
    let jsonl = dir.path().join("session.jsonl");
    std::fs::write(&jsonl, r#"{"message":{"content":[{"type":"tool_result","tool_use_id":"tool_1","content":"claude result"}]}}"#).unwrap();
    let mut adapter = StubAdapter::new("claude", false);
    Arc::get_mut(&mut adapter).unwrap().tool_reader = Some(Arc::new(
        mainframe_adapter_claude::adapter::ClaudeAdapter::default(),
    ));
    Arc::get_mut(&mut adapter).unwrap().transcript_location = Some(TranscriptLocation::Present(
        jsonl.to_string_lossy().into_owned(),
    ));
    ctx.core.adapter_registry.register(adapter);
    let id = seed_tool_result_chat(&ctx, "claude").await;

    let (status, body) =
        read(tool_result(State(ctx.clone()), Path((id.clone(), "tool_1".into()))).await)
            .await
            .unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["content"], "claude result");
    let stored = ctx
        .core
        .db
        .call(move |db| db.chats.get(&id))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.session_file_path.as_deref(), jsonl.to_str());
}

// ── includeTemporary ─────────────────────────────────────────────────────

async fn seed_one_temporary_chat(ctx: &Arc<AppCtx>) -> (String, String, String) {
    ctx.core
        .db
        .call(|db| {
            let project = db.projects.create("/tmp/temp-list", None)?;
            let normal = db.chats.create(&mainframe_types::chat::NewChat {
                project_id: project.id.clone(),
                adapter_id: "claude".to_string(),
                ..Default::default()
            })?;
            let temp = db.chats.create(&mainframe_types::chat::NewChat {
                project_id: project.id.clone(),
                adapter_id: "claude".to_string(),
                temporary: true,
                ..Default::default()
            })?;
            Ok((project.id, normal.id, temp.id))
        })
        .await
        .unwrap()
}

#[tokio::test]
async fn list_excludes_temporary_by_default_and_includes_it_when_asked() {
    let ctx = AppCtx::test_ctx();
    let (_, normal_id, temp_id) = seed_one_temporary_chat(&ctx).await;

    let excluded = ids_of(list(State(ctx.clone()), q(None, None, None)).await).await;
    assert!(excluded.contains(&normal_id));
    assert!(!excluded.contains(&temp_id));

    let included = ids_of(
        list(
            State(ctx.clone()),
            Query(ListQuery {
                project: None,
                tags: None,
                synthetic: None,
                include_temporary: Some(true),
            }),
        )
        .await,
    )
    .await;
    assert!(included.contains(&normal_id));
    assert!(included.contains(&temp_id));
}

#[tokio::test]
async fn list_for_project_excludes_temporary_by_default_and_includes_it_when_asked() {
    let ctx = AppCtx::test_ctx();
    let (project_id, normal_id, temp_id) = seed_one_temporary_chat(&ctx).await;

    let excluded = ids_of(
        list_for_project(
            State(ctx.clone()),
            Path(project_id.clone()),
            Query(ListForProjectQuery {
                include_temporary: None,
            }),
        )
        .await,
    )
    .await;
    assert!(excluded.contains(&normal_id));
    assert!(!excluded.contains(&temp_id));

    let included = ids_of(
        list_for_project(
            State(ctx.clone()),
            Path(project_id),
            Query(ListForProjectQuery {
                include_temporary: Some(true),
            }),
        )
        .await,
    )
    .await;
    assert!(included.contains(&normal_id));
    assert!(included.contains(&temp_id));
}

// Side-chat listing-exclusion tests moved to routes/chat_side_chat/tests.rs.
// ── archive/unarchive refuse a temporary chat (needs a real ChatManager) ───

async fn create_temporary_chat(ctx: &Arc<AppCtx>) -> String {
    ctx.chat
        .chat_manager
        .as_ref()
        .create_chat_with_defaults(
            mainframe_types::chat::NewChat {
                project_id: mainframe_types::chat::NO_PROJECT_ID.to_string(),
                adapter_id: "claude".to_string(),
                temporary: true,
                ..Default::default()
            },
            None,
            None,
        )
        .await
        .unwrap()
        .id
}

#[tokio::test]
async fn archive_refuses_a_temporary_chat_409() {
    let ctx = AppCtx::test_ctx();
    ctx.core
        .adapter_registry
        .register(crate::chat_test_support::StubAdapter::new("claude", false));
    let id = create_temporary_chat(&ctx).await;

    let (status, body) = read(
        archive(
            State(ctx.clone()),
            Path(id),
            Query(ArchiveQuery {
                delete_worktree: None,
            }),
        )
        .await,
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "cannot archive a temporary chat");
}

#[tokio::test]
async fn unarchive_refuses_a_temporary_chat_409() {
    let ctx = AppCtx::test_ctx();
    ctx.core
        .adapter_registry
        .register(crate::chat_test_support::StubAdapter::new("claude", false));
    let id = create_temporary_chat(&ctx).await;

    let (status, body) = read(unarchive(State(ctx.clone()), Path(id)).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "cannot unarchive a temporary chat");
}
