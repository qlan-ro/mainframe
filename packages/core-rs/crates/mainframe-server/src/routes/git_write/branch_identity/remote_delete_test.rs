use super::*;

#[tokio::test]
async fn remote_deletion_keeps_the_base_for_the_same_local_name() {
    let (ctx, project, repo) = project().await;
    let remote = tempfile::tempdir().unwrap();
    git(remote.path(), &["init", "--bare"]);
    git(
        repo.path(),
        &["remote", "add", "origin", remote.path().to_str().unwrap()],
    );
    git(repo.path(), &["push", "origin", "release:refs/heads/topic"]);
    git(repo.path(), &["branch", "origin/topic"]);
    let chat = chat_on(&ctx, &project, "origin/topic").await;

    let response = delete_branch(
        State(ctx.clone()),
        Path(project),
        Query(ChatIdQuery { chat_id: None }),
        Bytes::from_static(br#"{"name":"origin/topic","remote":true}"#),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    git(
        repo.path(),
        &["show-ref", "--verify", "refs/heads/origin/topic"],
    );
    assert_eq!(
        stored_chat(&ctx, &chat).await.base_branch.as_deref(),
        Some("release")
    );
}
