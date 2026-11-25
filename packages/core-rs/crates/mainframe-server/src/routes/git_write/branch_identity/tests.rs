use super::*;
use crate::worktree_base_tests::{project, stored_chat};
use mainframe_types::chat::NewChat;
use mainframe_types::chat_patch::ChatPatch;

fn git(repo: &std::path::Path, args: &[&str]) {
    let result = std::process::Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .unwrap();
    assert!(result.status.success(), "{result:?}");
}

async fn chat_on(ctx: &AppCtx, project_id: &str, name: &str) -> String {
    let chat = ctx
        .chat
        .chat_manager
        .create_chat(NewChat {
            project_id: project_id.into(),
            adapter_id: "claude".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    let id = chat.id.clone();
    let branch = name.to_string();
    ctx.core
        .db
        .call(move |db| {
            db.chats.update(
                &id,
                &ChatPatch {
                    branch_name: Some(Some(branch)),
                    base_branch: Some(Some("release".into())),
                    ..Default::default()
                },
            )
        })
        .await
        .unwrap();
    chat.id
}

async fn rename(ctx: &Arc<AppCtx>, project: &str, from: &str, to: &str) -> StatusCode {
    rename_branch(
        State(ctx.clone()),
        Path(project.into()),
        Query(ChatIdQuery { chat_id: None }),
        Bytes::from(json!({"oldName": from, "newName": to}).to_string()),
    )
    .await
    .status()
}

async fn delete(ctx: &Arc<AppCtx>, project: &str, name: &str) -> Response {
    delete_branch(
        State(ctx.clone()),
        Path(project.into()),
        Query(ChatIdQuery { chat_id: None }),
        Bytes::from(json!({"name": name, "force": true}).to_string()),
    )
    .await
}

#[tokio::test]
async fn rename_invalidates_both_names_and_keeps_stale_base_gone_on_reuse() {
    let (ctx, project, repo) = project().await;
    let first = ctx
        .chat
        .chat_manager
        .create_chat(NewChat {
            project_id: project.clone(),
            adapter_id: "claude".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    ctx.chat
        .chat_manager
        .enable_worktree(&first.id, "release", "topic")
        .await
        .unwrap();
    let other = chat_on(&ctx, &project, "renamed").await;
    let unrelated = chat_on(&ctx, &project, "unrelated").await;
    let restored = stored_chat(&ctx, &first.id).await;
    let directory = restored.worktree_path.clone().unwrap();
    let peer_project = ctx
        .core
        .db
        .call(move |db| db.projects.create(&directory, None))
        .await
        .unwrap()
        .id;
    let peer = chat_on(&ctx, &peer_project, "topic").await;
    assert_eq!(restored.base_branch.as_deref(), Some("release"));

    assert_eq!(
        rename(&ctx, &project, "topic", "renamed").await,
        StatusCode::OK
    );
    git(repo.path(), &["branch", "other"]);
    assert_eq!(
        rename(&ctx, &project, "other", "topic").await,
        StatusCode::OK
    );
    let worktree = std::path::Path::new(restored.worktree_path.as_deref().unwrap());
    git(worktree, &["checkout", "topic"]);

    let stored = stored_chat(&ctx, &first.id).await;
    assert_eq!(stored.branch_name.as_deref(), Some("topic"));
    assert_eq!(stored.base_branch, None);
    assert_eq!(
        ctx.chat
            .chat_manager
            .get_chat(&first.id)
            .unwrap()
            .base_branch,
        None
    );
    assert_eq!(stored_chat(&ctx, &other).await.base_branch, None);
    assert_eq!(stored_chat(&ctx, &peer).await.base_branch, None);
    assert_eq!(
        stored_chat(&ctx, &unrelated).await.base_branch.as_deref(),
        Some("release")
    );
}

#[tokio::test]
async fn delete_clears_matching_bases_only_when_git_deletes_the_branch() {
    let (ctx, project, repo) = project().await;
    git(repo.path(), &["branch", "topic"]);
    let chat = chat_on(&ctx, &project, "topic").await;
    let still_checked_out = chat_on(&ctx, &project, "release").await;

    let (status, _) = crate::test_support::read_json(delete(&ctx, &project, "topic").await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::OK);
    git(repo.path(), &["branch", "topic"]);
    assert_eq!(stored_chat(&ctx, &chat).await.base_branch, None);
    assert_eq!(
        stored_chat(&ctx, &chat).await.branch_name.as_deref(),
        Some("topic")
    );

    assert_eq!(
        delete(&ctx, &project, "release").await.status(),
        StatusCode::OK
    );
    assert_eq!(
        stored_chat(&ctx, &still_checked_out)
            .await
            .base_branch
            .as_deref(),
        Some("release")
    );
}

async fn install_trigger(ctx: &AppCtx, sql: &'static str) {
    ctx.core
        .db
        .call(move |db| Ok(db.connection().execute_batch(sql)?))
        .await
        .unwrap();
}

#[tokio::test]
async fn failed_rename_restores_candidates_and_the_active_cache() {
    let (ctx, project, repo) = project().await;
    let chat = ctx
        .chat
        .chat_manager
        .create_chat(NewChat {
            project_id: project.clone(),
            adapter_id: "claude".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    ctx.chat
        .chat_manager
        .enable_worktree(&chat.id, "release", "topic")
        .await
        .unwrap();
    git(repo.path(), &["branch", "occupied"]);

    assert_eq!(
        rename(&ctx, &project, "topic", "occupied").await,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        stored_chat(&ctx, &chat.id).await.base_branch.as_deref(),
        Some("release")
    );
    assert_eq!(
        ctx.chat
            .chat_manager
            .get_chat(&chat.id)
            .unwrap()
            .base_branch
            .as_deref(),
        Some("release")
    );
}

#[tokio::test]
async fn failed_clear_leaves_git_and_the_base_untouched() {
    let (ctx, project, repo) = project().await;
    git(repo.path(), &["branch", "topic"]);
    let chat = chat_on(&ctx, &project, "topic").await;
    install_trigger(
        &ctx,
        "CREATE TRIGGER fail_clear BEFORE UPDATE OF base_branch ON chats
        WHEN NEW.base_branch IS NULL BEGIN SELECT RAISE(ABORT, 'test clear failure'); END;",
    )
    .await;

    assert_eq!(
        rename(&ctx, &project, "topic", "renamed").await,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        delete(&ctx, &project, "topic").await.status(),
        StatusCode::INTERNAL_SERVER_ERROR
    );
    git(repo.path(), &["branch", "-m", "topic", "renamed"]);
    assert_eq!(
        stored_chat(&ctx, &chat).await.base_branch.as_deref(),
        Some("release")
    );
}

#[tokio::test]
async fn failed_restore_leaves_the_base_unset() {
    let (ctx, project, repo) = project().await;
    git(repo.path(), &["branch", "topic"]);
    let chat = chat_on(&ctx, &project, "topic").await;
    install_trigger(
        &ctx,
        "CREATE TRIGGER fail_restore BEFORE UPDATE OF base_branch ON chats
        WHEN NEW.base_branch IS NOT NULL BEGIN SELECT RAISE(ABORT, 'test restore failure'); END;",
    )
    .await;

    assert_eq!(
        rename(&ctx, &project, "topic", "release").await,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(stored_chat(&ctx, &chat).await.base_branch, None);
}

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
