use super::*;
use axum::body::to_bytes;

async fn read(resp: Response) -> (StatusCode, serde_json::Value) {
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

#[tokio::test]
async fn list_unknown_adapter_404() {
    let ctx = AppCtx::test_ctx();
    let resp = list::<false>(
        State(ctx.clone()),
        Path("codex".into()),
        Query(ProjectPathQuery {
            project_path: Some("/tmp".into()),
        }),
    )
    .await;
    let (status, body) = read(resp).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], unsupported::<false>());
}

#[tokio::test]
async fn create_unknown_adapter_404() {
    let ctx = AppCtx::test_ctx();
    let resp = create::<false>(
        State(ctx.clone()),
        Path("codex".into()),
        axum::body::Bytes::from("{}"),
    )
    .await;
    assert_eq!(read(resp).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn list_mock_adapter_scans_project_agents() {
    let temp = tempfile::tempdir().unwrap();
    let agent_dir = temp.path().join(".claude/agents");
    tokio::fs::create_dir_all(&agent_dir).await.unwrap();
    tokio::fs::write(agent_dir.join("planner.md"), "# Plans changes\nBody\n")
        .await
        .unwrap();
    let ctx = AppCtx::test_ctx();
    ctx.core
        .adapter_registry
        .register(Arc::new(mainframe_adapter_mock::MockCliAdapter::default()));

    let response = list::<false>(
        State(ctx),
        Path("mock-cli".into()),
        Query(ProjectPathQuery {
            project_path: Some(temp.path().to_string_lossy().to_string()),
        }),
    )
    .await;
    let (status, body) = read(response).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"][0]["id"], "mock-cli:project:agent:planner");
}

#[tokio::test]
async fn list_agents_uses_capability_for_an_unfamiliar_adapter_id() {
    let temp = tempfile::tempdir().unwrap();
    let agent_dir = temp.path().join(".claude/agents");
    tokio::fs::create_dir_all(&agent_dir).await.unwrap();
    tokio::fs::write(agent_dir.join("planner.md"), "# Plans changes\nBody\n")
        .await
        .unwrap();
    let ctx = AppCtx::test_ctx();
    ctx.core.adapter_registry.register(Arc::new(
        mainframe_adapter_mock::MockCliAdapter::default().with_identity("third-provider", "Third"),
    ));

    let response = list::<false>(
        State(ctx),
        Path("third-provider".into()),
        Query(ProjectPathQuery {
            project_path: Some(temp.path().to_string_lossy().to_string()),
        }),
    )
    .await;
    let (status, body) = read(response).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"][0]["id"], "mock-cli:project:agent:planner");
}
