#[tokio::test]
async fn fork_refuses_a_side_chat() {
    let (ctx, _project, parent) = setup().await;
    let (_, body) = open(&ctx, &parent.id, b"").await;
    let side_id = body["data"]["id"].as_str().unwrap().to_string();

    let err = ctx
        .chat
        .chat_manager
        .as_ref()
        .fork_chat(&side_id, mainframe_chat::chat_manager::ForkPoint::Current)
        .await
        .unwrap_err();
    // StubAdapter isn't fork-capable, so this may surface as Unsupported
    // rather than Temporary — either way, fork never succeeds for a side chat.
    assert!(
        matches!(
            err,
            mainframe_chat::chat_manager::ForkChatError::Unsupported(_)
                | mainframe_chat::chat_manager::ForkChatError::Temporary
        ),
        "{err:?}"
    );
}

// ── project removal cascade ─────────────────────────────────────────────

#[tokio::test]
async fn removing_the_project_deletes_the_side_chats_row() {
    let (ctx, project, parent) = setup().await;
    let (_, body) = open(&ctx, &parent.id, b"").await;
    let side_id = body["data"]["id"].as_str().unwrap().to_string();
    let cm = &ctx.chat.chat_manager;

    cm.remove_project(&project.id).await.unwrap();

    assert!(cm.get_chat(&parent.id).is_none());
    assert!(cm.get_chat(&side_id).is_none());
}

// ── side chats are never listed, even with includeTemporary — exercises
// `chats::list`/`list_for_project`/`get_one` directly since those routes,
// not this one, own the listing exclusion. ────────────────────────────────

fn q(project: Option<&str>, tags: Option<&str>, synthetic: Option<&str>) -> Query<ListQuery> {
    Query(ListQuery {
        project: project.map(str::to_string),
        tags: tags.map(str::to_string),
        synthetic: synthetic.map(str::to_string),
        include_temporary: None,
    })
}

async fn ids_of(resp: Response) -> Vec<String> {
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::OK);
    let mut ids: Vec<String> = body["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap().to_string())
        .collect();
    ids.sort();
    ids
}

async fn seed_a_side_chat(ctx: &Arc<AppCtx>) -> (String, String, String) {
    ctx.core
        .db
        .call(|db| {
            let project = db.projects.create("/tmp/side-chat-list", None)?;
            let parent = db.chats.create(&mainframe_types::chat::NewChat {
                project_id: project.id.clone(),
                adapter_id: "claude".to_string(),
                ..Default::default()
            })?;
            let (side, _created) = db.chats.find_or_create_side_chat(&parent)?;
            Ok((project.id, parent.id, side.id))
        })
        .await
        .unwrap()
}

#[tokio::test]
async fn list_never_returns_a_side_chat_with_or_without_include_temporary() {
    let ctx = AppCtx::test_ctx();
    let (_, parent_id, side_id) = seed_a_side_chat(&ctx).await;

    let excluded = ids_of(list(State(ctx.clone()), q(None, None, None)).await).await;
    assert!(excluded.contains(&parent_id));
    assert!(!excluded.contains(&side_id));

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
    assert!(!included.contains(&side_id));
}

#[tokio::test]
async fn list_for_project_never_returns_a_side_chat_with_or_without_include_temporary() {
    let ctx = AppCtx::test_ctx();
    let (project_id, parent_id, side_id) = seed_a_side_chat(&ctx).await;

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
    assert!(excluded.contains(&parent_id));
    assert!(!excluded.contains(&side_id));

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
    assert!(!included.contains(&side_id));
}

#[tokio::test]
async fn get_one_still_returns_a_side_chat_directly() {
    let ctx = AppCtx::test_ctx();
    let (_, _parent_id, side_id) = seed_a_side_chat(&ctx).await;
    let (status, body) = read(get_one(State(ctx.clone()), Path(side_id.clone())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["id"], side_id);
}
