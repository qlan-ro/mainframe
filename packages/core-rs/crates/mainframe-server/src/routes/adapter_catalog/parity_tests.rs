use super::*;

fn registered() -> Arc<AppCtx> {
    let ctx = AppCtx::test_ctx();
    ctx.core
        .adapter_registry
        .register(Arc::new(mainframe_adapter_codex::CodexAdapter::new(
            Arc::new(mainframe_background_tasks::tracker::BackgroundTaskTracker::new()),
            mainframe_runtime::ResolvedPath::from_value("/usr/bin"),
        )));
    ctx.core
        .adapter_registry
        .register(Arc::new(mainframe_adapter_mock::MockCliAdapter::default()));
    ctx
}

#[tokio::test]
async fn registered_codex_agents_are_unsupported() {
    let response = list::<false>(
        State(registered()),
        Path("codex".into()),
        Query(ProjectPathQuery {
            project_path: Some("/tmp".into()),
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

async fn assert_read_only<const SKILL: bool>(ctx: Arc<AppCtx>, id: &str) {
    let response = create::<SKILL>(State(ctx.clone()), Path(id.into()), Bytes::from("{}")).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let response = update::<SKILL>(
        State(ctx.clone()),
        Path((id.into(), "entry".into())),
        Bytes::from("{}"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let response = delete::<SKILL>(
        State(ctx),
        Path((id.into(), "entry".into())),
        Query(ProjectPathQuery {
            project_path: Some("/tmp".into()),
        }),
        Bytes::new(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn registered_codex_and_mock_catalogs_reject_all_mutations() {
    let ctx = registered();
    for id in ["codex", "mock-cli"] {
        assert_read_only::<true>(ctx.clone(), id).await;
        assert_read_only::<false>(ctx.clone(), id).await;
    }
}
