use super::*;

use crate::test_support::read_json as read;

#[tokio::test]
async fn list_worktrees_missing_project_404() {
    let ctx = AppCtx::test_ctx();
    let (status, body) = read(list_worktrees(State(ctx.clone()), Path("nope".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "Project not found");
}

/// Intentional change: enabling a worktree on an unknown chat answered
/// 400; the chat is missing, so it is now a 404 with the same text.
#[tokio::test]
async fn enable_on_an_unknown_chat_is_404() {
    let ctx = AppCtx::test_ctx();
    let resp = enable_worktree(
        State(ctx.clone()),
        Path("ghost".into()),
        axum::body::Bytes::from(r#"{"baseBranch":"main","branchName":"feat"}"#),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "Chat ghost not found");
}

/// Intentional change: forking an unknown chat into a worktree answered
/// 500; it is now a 404 with the same text.
#[tokio::test]
async fn fork_of_an_unknown_chat_is_404() {
    let ctx = AppCtx::test_ctx();
    let resp = fork_worktree(
        State(ctx.clone()),
        Path("ghost".into()),
        axum::body::Bytes::from(r#"{"baseBranch":"main","branchName":"feat"}"#),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "Chat ghost not found");
}

#[tokio::test]
async fn enable_rejects_missing_base_branch_400() {
    let ctx = AppCtx::test_ctx();
    let resp = enable_worktree(
        State(ctx.clone()),
        Path("c".into()),
        axum::body::Bytes::from(r#"{"branchName":"feat"}"#),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "Base branch is required");
}

#[tokio::test]
async fn enable_rejects_bad_branch_name_400() {
    let ctx = AppCtx::test_ctx();
    let resp = enable_worktree(
        State(ctx.clone()),
        Path("c".into()),
        axum::body::Bytes::from(r#"{"baseBranch":"main","branchName":"../evil"}"#),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "Invalid branch name");
}

#[test]
fn branch_name_validation() {
    assert!(branch_name_ok("feature/x-1.2_y"));
    assert!(!branch_name_ok("../escape"));
    assert!(!branch_name_ok("-leading"));
    assert!(!branch_name_ok(""));
}

#[tokio::test]
async fn worktree_base_enable_and_fork_routes_persist_the_selected_base() {
    use crate::worktree_base_tests::{project, stored_chat};
    use mainframe_types::chat::NewChat;

    let (ctx, project_id, _repo) = project().await;
    let chat = ctx
        .chat
        .chat_manager
        .create_chat(NewChat {
            project_id: project_id.clone(),
            adapter_id: "claude".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    let (status, _) = read(
        enable_worktree(
            State(ctx.clone()),
            Path(chat.id.clone()),
            axum::body::Bytes::from_static(
                br#"{"baseBranch":"release","branchName":"draft/topic"}"#,
            ),
        )
        .await,
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        stored_chat(&ctx, &chat.id).await.base_branch.as_deref(),
        Some("release")
    );

    let (status, body) = read(
        fork_worktree(
            State(ctx.clone()),
            Path(chat.id),
            axum::body::Bytes::from_static(
                br#"{"baseBranch":"release","branchName":"fork/topic"}"#,
            ),
        )
        .await,
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::OK);
    let id = body["data"]["chatId"].as_str().unwrap();
    let fork = stored_chat(&ctx, id).await;
    assert_eq!(fork.base_branch.as_deref(), Some("release"));
    let request = serde_json::json!({ "worktreePath": fork.worktree_path });
    let (status, _) = read(
        delete_worktree(
            State(ctx.clone()),
            Path(project_id),
            axum::body::Bytes::from(request.to_string()),
        )
        .await,
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::OK);
    let deleted = stored_chat(&ctx, id).await;
    assert_eq!(deleted.base_branch, None);
    assert_eq!(deleted.worktree_path, fork.worktree_path);
}
