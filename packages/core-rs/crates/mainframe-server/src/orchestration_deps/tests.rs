//! The daemon port over a real `ChatManager` (stub adapter, in-memory DB).

use std::sync::Arc;

use mainframe_orchestration::errors::{ErrorCode, PortError};
use mainframe_orchestration::ports::{LaunchRequest, LaunchWorkspace, OrchestrationPort};
use mainframe_types::chat::{NO_PROJECT_ID, NewChat};
use mainframe_types::settings::ExecutionMode;

use super::DaemonOrchestrationPort;
use crate::chat_test_support::StubAdapter;
use crate::ctx::AppCtx;

async fn setup() -> (Arc<AppCtx>, DaemonOrchestrationPort, String, String) {
    let ctx = AppCtx::test_ctx_with_orchestration();
    ctx.adapter_registry
        .register(StubAdapter::new("claude", false));
    let dir = std::env::temp_dir().join(format!("mf-orch-{}", nanoid::nanoid!()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.to_string_lossy().into_owned();
    let project = ctx
        .db
        .call(move |d| d.projects.create(&path, None))
        .await
        .unwrap();
    let chats = ctx.chat_manager.clone().unwrap();
    let caller = chats
        .create_chat(NewChat {
            project_id: project.id.clone(),
            adapter_id: "claude".into(),
            ..Default::default()
        })
        .await;
    let port = DaemonOrchestrationPort::new(
        chats,
        ctx.db.clone(),
        Arc::clone(&ctx.adapter_registry),
        ctx.broadcast.clone(),
    );
    (ctx, port, project.id, caller.id)
}

fn request(project_id: &str, caller: &str, workspace: LaunchWorkspace) -> LaunchRequest {
    LaunchRequest {
        project_id: project_id.into(),
        adapter_id: "claude".into(),
        model: None,
        permission_mode: ExecutionMode::AcceptEdits,
        plan_mode: true,
        title: Some("Review".into()),
        workspace,
        created_by_chat_id: caller.into(),
        parent_chat_id: None,
    }
}

fn code(err: PortError) -> Option<ErrorCode> {
    match err {
        PortError::Public(err) => Some(err.code),
        PortError::Internal(_) => None,
    }
}

#[tokio::test]
async fn launch_creates_a_chat_with_provenance_mode_plan_and_title() {
    let (_ctx, port, project_id, caller) = setup().await;
    let chat = port
        .launch_chat(request(&project_id, &caller, LaunchWorkspace::ProjectRoot))
        .await
        .unwrap();
    assert_eq!(chat.created_by_chat_id.as_deref(), Some(caller.as_str()));
    assert_eq!(chat.permission_mode, ExecutionMode::AcceptEdits);
    assert!(chat.plan_mode);
    assert_eq!(chat.title.as_deref(), Some("Review"));
    assert_eq!(chat.parent_chat_id, None);

    let listed = port.list_chats(&project_id, false).await;
    let found = listed.iter().find(|c| c.id == chat.id).unwrap();
    assert_eq!(found.created_by_chat_id.as_deref(), Some(caller.as_str()));
}

#[tokio::test]
async fn invalid_workspaces_are_refused_before_anything_is_created() {
    let (_ctx, port, project_id, caller) = setup().await;
    let before = port.list_chats(&project_id, true).await.len();
    let bad_branch = LaunchWorkspace::NewWorktree {
        base_branch: "main".into(),
        branch_name: "-oops".into(),
    };
    let err = port
        .launch_chat(request(&project_id, &caller, bad_branch))
        .await
        .unwrap_err();
    assert_eq!(code(err), Some(ErrorCode::WorkspaceInvalid));
    let foreign = LaunchWorkspace::ExistingWorktree {
        worktree_path: std::env::temp_dir().to_string_lossy().into_owned(),
    };
    let err = port
        .launch_chat(request(&project_id, &caller, foreign))
        .await
        .unwrap_err();
    assert_eq!(code(err), Some(ErrorCode::WorkspaceInvalid));
    let no_project = LaunchWorkspace::NewWorktree {
        base_branch: "main".into(),
        branch_name: "x".into(),
    };
    let err = port
        .launch_chat(request(NO_PROJECT_ID, &caller, no_project))
        .await
        .unwrap_err();
    assert_eq!(code(err), Some(ErrorCode::WorkspaceInvalid));
    assert_eq!(port.list_chats(&project_id, true).await.len(), before);
}

#[tokio::test]
async fn a_spawn_through_the_chat_manager_issues_a_credential() {
    let (ctx, _port, _project_id, caller) = setup().await;
    let service = ctx.orchestration.clone().unwrap();
    let chats = ctx.chat_manager.clone().unwrap();
    assert!(!service.credentials().has_credential(&caller));
    chats.start_chat(&caller).await;
    assert!(service.credentials().has_credential(&caller));
    chats.end_chat(&caller).await;
    assert!(!service.credentials().has_credential(&caller));
}

#[tokio::test]
async fn a_delegated_child_reports_its_task_and_boot_interrupts_open_tasks() {
    use mainframe_orchestration::ports::TaskStore;
    use mainframe_types::orchestration::{DelegatedTask, TaskDelivery, TaskRole, TaskStatus};

    let (ctx, port, project_id, caller) = setup().await;
    let mut launch = request(&project_id, &caller, LaunchWorkspace::ProjectRoot);
    launch.parent_chat_id = Some(caller.clone());
    let child = port.launch_chat(launch).await.unwrap();
    let store = super::DbTaskStore::new(ctx.db.clone());
    let task = DelegatedTask {
        id: "task_1".into(),
        parent_chat_id: caller.clone(),
        child_chat_id: child.id.clone(),
        client_request_id: None,
        title: None,
        role: TaskRole::General,
        status: TaskStatus::Running,
        depth: 1,
        summary: None,
        error: None,
        cancel_reason: None,
        delivery: TaskDelivery::Pending,
        created_at: "t".into(),
        updated_at: "t".into(),
        completed_at: None,
    };
    store.insert(task).await.unwrap();

    let view = port.chat(&child.id).await.unwrap();
    assert_eq!(view.task_id.as_deref(), Some("task_1"));
    assert_eq!(view.parent_chat_id.as_deref(), Some(caller.as_str()));
    let listed = port.list_chats(&project_id, false).await;
    let row = listed.iter().find(|c| c.id == child.id).unwrap();
    assert_eq!(row.task_id.as_deref(), Some("task_1"));

    ctx.orchestration.clone().unwrap().reconcile_boot().await;
    let after = store.get("task_1").await.unwrap();
    assert_eq!(after.status, TaskStatus::Interrupted);
    assert_eq!(after.delivery, TaskDelivery::Dropped);
}
