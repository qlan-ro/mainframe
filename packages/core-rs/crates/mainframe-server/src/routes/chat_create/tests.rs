use axum::body::to_bytes;

use super::*;

async fn read(resp: Response) -> (StatusCode, serde_json::Value) {
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

#[tokio::test]
async fn create_rejects_missing_fields_400() {
    let ctx = AppCtx::test_ctx();
    let resp = create(
        State(ctx.clone()),
        axum::body::Bytes::from(r#"{"projectId":"p"}"#),
    )
    .await;
    assert_eq!(read(resp).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_rejects_worktree_without_branch_400() {
    let ctx = AppCtx::test_ctx();
    let resp = create(
        State(ctx.clone()),
        axum::body::Bytes::from(r#"{"projectId":"p","adapterId":"claude","worktreePath":"/wt"}"#),
    )
    .await;
    let (status, body) = read(resp).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["error"],
        "worktreePath and branchName must be provided together"
    );
}

#[tokio::test]
async fn create_rejects_an_unknown_project_id_400_and_writes_no_row() {
    let ctx = AppCtx::test_ctx();
    let resp = create(
        State(ctx.clone()),
        axum::body::Bytes::from(r#"{"projectId":"nope","adapterId":"claude"}"#),
    )
    .await;
    let (status, body) = read(resp).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "Project not found");
    let rows = ctx.db.call(|db| db.chats.list_all()).await.unwrap();
    assert!(rows.is_empty(), "a rejected create must write no chat row");
}

#[tokio::test]
async fn create_rejects_the_scratch_project_id_as_an_unknown_project_400() {
    let ctx = AppCtx::test_ctx();
    let resp = create(
        State(ctx.clone()),
        axum::body::Bytes::from(r#"{"projectId":"mainframe-no-project","adapterId":"claude"}"#),
    )
    .await;
    assert_eq!(read(resp).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_rejects_no_project_together_with_a_project_id_400() {
    let ctx = AppCtx::test_ctx();
    let resp = create(
        State(ctx.clone()),
        axum::body::Bytes::from(r#"{"projectId":"p","noProject":true,"adapterId":"claude"}"#),
    )
    .await;
    assert_eq!(read(resp).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_rejects_no_project_with_a_worktree_400() {
    let ctx = AppCtx::test_ctx();
    let resp = create(
        State(ctx.clone()),
        axum::body::Bytes::from(
            r#"{"noProject":true,"adapterId":"claude","worktreePath":"/wt","branchName":"b"}"#,
        ),
    )
    .await;
    let (status, body) = read(resp).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "a non-project chat cannot have a worktree");
}

#[tokio::test]
async fn create_rejects_neither_project_nor_no_project_400() {
    let ctx = AppCtx::test_ctx();
    let resp = create(
        State(ctx.clone()),
        axum::body::Bytes::from(r#"{"adapterId":"claude"}"#),
    )
    .await;
    assert_eq!(read(resp).await.0, StatusCode::BAD_REQUEST);
}

// ── success paths (todo #346, AC 26 — need a real ChatManager) ───────────

#[tokio::test]
async fn create_succeeds_with_a_project() {
    let ctx = AppCtx::test_ctx_with_chat_manager();
    ctx.adapter_registry
        .register(crate::chat_test_support::StubAdapter::new("claude", false));
    let project = ctx
        .db
        .call(|db| db.projects.create("/tmp/create-with-project", None))
        .await
        .unwrap();

    let resp = create(
        State(ctx.clone()),
        axum::body::Bytes::from(format!(
            r#"{{"projectId":"{}","adapterId":"claude"}}"#,
            project.id
        )),
    )
    .await;
    let (status, body) = read(resp).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["projectId"], project.id);
    assert_eq!(body["data"]["temporary"], false);

    let rows = ctx.db.call(|db| db.chats.list_all()).await.unwrap();
    assert_eq!(rows.len(), 1);
}

#[tokio::test]
async fn create_succeeds_with_no_project() {
    let ctx = AppCtx::test_ctx_with_chat_manager();
    ctx.adapter_registry
        .register(crate::chat_test_support::StubAdapter::new("claude", false));

    let resp = create(
        State(ctx.clone()),
        axum::body::Bytes::from(r#"{"noProject":true,"adapterId":"claude"}"#),
    )
    .await;
    let (status, body) = read(resp).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["projectId"], NO_PROJECT_ID);
    assert_eq!(body["data"]["noProject"], true);

    let rows = ctx.db.call(|db| db.chats.list_all()).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert!(
        rows[0].scratch_path.is_some(),
        "a non-project chat is given a scratch path (daemon-internal, not on the wire)"
    );
}

#[tokio::test]
async fn create_succeeds_with_temporary() {
    let ctx = AppCtx::test_ctx_with_chat_manager();
    ctx.adapter_registry
        .register(crate::chat_test_support::StubAdapter::new("claude", false));

    let resp = create(
        State(ctx.clone()),
        axum::body::Bytes::from(r#"{"noProject":true,"adapterId":"claude","temporary":true}"#),
    )
    .await;
    let (status, body) = read(resp).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["temporary"], true);

    let rows = ctx.db.call(|db| db.chats.list_all()).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert!(rows[0].temporary);
}
