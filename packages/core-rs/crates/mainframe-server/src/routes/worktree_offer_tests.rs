use super::*;

use crate::test_support::read_json as read;

#[tokio::test]
async fn accept_rejects_empty_body_400() {
    let ctx = AppCtx::test_ctx();
    let resp = accept_worktree_offer(
        State(ctx.clone()),
        Path("c".into()),
        axum::body::Bytes::from(""),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "Worktree path is required");
}

#[tokio::test]
async fn accept_rejects_empty_worktree_path_400() {
    let ctx = AppCtx::test_ctx();
    let resp = accept_worktree_offer(
        State(ctx.clone()),
        Path("c".into()),
        axum::body::Bytes::from(r#"{"worktreePath":""}"#),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "Worktree path is required");
}

#[tokio::test]
async fn dismiss_rejects_empty_body_400() {
    let ctx = AppCtx::test_ctx();
    let resp = dismiss_worktree_offer(
        State(ctx.clone()),
        Path("c".into()),
        axum::body::Bytes::from(""),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "Worktree path is required");
}

#[tokio::test]
async fn accept_and_dismiss_reject_an_offer_that_is_not_pending() {
    let ctx = AppCtx::test_ctx();
    let (accept_status, accept_body) = read(
        accept_worktree_offer(
            State(ctx.clone()),
            Path("c".into()),
            axum::body::Bytes::from(r#"{"worktreePath":"/tmp/wt"}"#),
        )
        .await,
    )
    .await
    .unwrap();
    assert_eq!(accept_status, StatusCode::BAD_REQUEST);
    assert_eq!(
        accept_body["error"],
        "No pending worktree offer for that path"
    );

    let (dismiss_status, dismiss_body) = read(
        dismiss_worktree_offer(
            State(ctx.clone()),
            Path("c".into()),
            axum::body::Bytes::from(r#"{"worktreePath":"/tmp/wt"}"#),
        )
        .await,
    )
    .await
    .unwrap();
    assert_eq!(dismiss_status, StatusCode::BAD_REQUEST);
    assert_eq!(
        dismiss_body["error"],
        "No pending worktree offer for that path"
    );
}
