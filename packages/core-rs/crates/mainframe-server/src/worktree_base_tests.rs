use std::sync::Arc;

use mainframe_orchestration::ports::{LaunchRequest, LaunchWorkspace, OrchestrationPort};
use mainframe_types::chat::Chat;
use mainframe_types::settings::ExecutionMode;

use crate::automations_deps::{AgentChatPort, ChatManagerPort};
use crate::chat_test_support::StubAdapter;
use crate::ctx::AppCtx;
use crate::orchestration_deps::DaemonOrchestrationPort;

pub(crate) async fn project() -> (Arc<AppCtx>, String, tempfile::TempDir) {
    let repo = tempfile::tempdir().unwrap();
    for args in [
        &["init", "-b", "release"][..],
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "initial",
        ],
    ] {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(repo.path())
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
    }
    std::fs::write(repo.path().join(".git/info/exclude"), ".worktrees/\n").unwrap();
    let ctx = AppCtx::test_ctx();
    ctx.core
        .adapter_registry
        .register(StubAdapter::new("claude", false));
    let path = repo.path().to_str().unwrap().to_owned();
    let id = ctx
        .core
        .db
        .call(move |d| d.projects.create(&path, None))
        .await
        .unwrap()
        .id;
    (ctx, id, repo)
}

pub(crate) async fn stored_chat(ctx: &AppCtx, id: &str) -> Chat {
    let id = id.to_string();
    ctx.core
        .db
        .call(move |d| d.chats.get(&id))
        .await
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn orchestration_launch_persists_the_creation_base() {
    let (ctx, project_id, _repo) = project().await;
    let port = DaemonOrchestrationPort::new(
        ctx.chat.chat_manager.clone(),
        ctx.core.db.clone(),
        ctx.core.adapter_registry.clone(),
        ctx.core.broadcast.clone(),
    );
    let launched = port
        .launch_chat(LaunchRequest {
            project_id,
            adapter_id: "claude".into(),
            model: None,
            permission_mode: ExecutionMode::Default,
            plan_mode: false,
            title: None,
            workspace: LaunchWorkspace::NewWorktree {
                base_branch: "release".into(),
                branch_name: "launch/review".into(),
            },
            created_by_chat_id: "caller".into(),
            parent_chat_id: None,
        })
        .await
        .unwrap();
    let chat = stored_chat(&ctx, &launched.id).await;
    assert_eq!(chat.branch_name.as_deref(), Some("launch/review"));
    assert_eq!(chat.base_branch.as_deref(), Some("release"));
}

#[tokio::test]
async fn automation_records_the_creation_base_and_omits_it_on_reuse() {
    let (ctx, project_id, _repo) = project().await;
    let port = ChatManagerPort::new(ctx.chat.chat_manager.clone());
    for (run_id, expected_base) in [("run-1", Some("release")), ("run-2", None)] {
        let id = port
            .create_chat(
                &project_id,
                "claude",
                None,
                None,
                Some("auto/review"),
                run_id,
            )
            .await
            .unwrap();
        port.enable_or_reuse_worktree(&id, "release", "auto/review")
            .await
            .unwrap();
        let chat = stored_chat(&ctx, &id).await;
        assert_eq!(chat.branch_name.as_deref(), Some("auto/review"));
        assert_eq!(chat.base_branch.as_deref(), expected_base);
    }
}
