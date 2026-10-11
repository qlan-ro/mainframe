use super::*;

use crate::test_support::read_json as read;

#[tokio::test]
async fn list_rejects_out_of_range_limit_400() {
    let ctx = AppCtx::test_ctx();
    let resp = list(
        State(ctx.clone()),
        Path("p".into()),
        Query(ListQuery {
            offset: Some(0),
            limit: Some(300),
        }),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "Invalid query params");
}

#[tokio::test]
async fn list_valid_query_uses_the_real_service() {
    let ctx = AppCtx::test_ctx();
    let resp = list(
        State(ctx.clone()),
        Path("p".into()),
        Query(ListQuery {
            offset: None,
            limit: None,
        }),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], true);
}

#[tokio::test]
async fn import_rejects_bad_session_id_400() {
    let ctx = AppCtx::test_ctx();
    let resp = import(
        State(ctx.clone()),
        Path("p".into()),
        axum::body::Bytes::from(r#"{"sessionId":"bad id!","adapterId":"claude"}"#),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "Invalid request body");
}

#[tokio::test]
async fn import_valid_body_uses_the_real_service() {
    let ctx = AppCtx::test_ctx();
    let project = ctx
        .core
        .db
        .call(|db| db.projects.create("/project", None))
        .await
        .unwrap();
    let resp = import(
        State(ctx.clone()),
        Path(project.id),
        axum::body::Bytes::from(r#"{"sessionId":"abc-123","adapterId":"claude"}"#),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], true);
}

#[tokio::test]
async fn import_into_a_missing_project_does_not_return_an_unsaved_chat() {
    let resp = import(
        State(AppCtx::test_ctx()),
        Path("missing".into()),
        axum::body::Bytes::from(r#"{"sessionId":"abc-123","adapterId":"claude"}"#),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["success"], false);
    assert!(body.get("data").is_none());
}
