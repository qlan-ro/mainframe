//! Creating a delegated task: every check, the child chat, the task row, and
//! the prompt.

use mainframe_types::orchestration::{DelegatedTask, TaskDelivery, TaskRole, TaskStatus};

use super::Input;
use crate::calls::CallCtx;
use crate::errors::{ToolError, cap_chars};
use crate::input::WorkspaceMode;
use crate::ports::{ChatView, LaunchRequest, LaunchWorkspace};
use crate::service::OrchestrationService;
use crate::state::{AgentMessageKind, wrap_agent_message};
use crate::tasks::now;
use crate::tools::launch_common::{
    admit_creation, resolve_adapter, resolve_privileges, resolve_workspace,
};

pub(super) enum Created {
    New(DelegatedTask),
    /// A concurrent call with the same `clientRequestId` got there first.
    Existing(DelegatedTask),
}

/// Checks and creates under the tree's lock: the idempotency check, the limit
/// checks, and the insert must run as one step, or two concurrent calls can
/// both pass every check before either has inserted. The lock is released
/// before a `wait` call blocks, so it never holds up a sibling delegation.
pub(super) async fn create(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    input: &Input,
    caller: &ChatView,
) -> Result<Created, ToolError> {
    let _guard = svc.tree_locks.acquire(&svc.tree_key(caller).await?).await;
    // The caller may have been stopped while this call waited for the lock.
    // The Stop's sweep only cancels tasks that existed when it ran, so a task
    // inserted now would outlive it.
    svc.active_caller(ctx).await?;
    if let Some(existing) = find_existing(svc, input, caller).await? {
        return Ok(Created::Existing(existing));
    }
    let request = build_request(svc, input, caller).await?;
    svc.check_task_limits(&caller.id).await?;
    admit_creation(svc, caller).await?;
    let new_worktree = matches!(request.workspace, LaunchWorkspace::NewWorktree { .. });
    let child = svc.port.launch_chat(request).await?;
    let task = match record(svc, input, caller, &child).await {
        Ok(task) => task,
        Err(err) => {
            // Without its row the child is unreachable for the caller.
            svc.port.retire_chat(&child.id, new_worktree).await;
            return Err(err);
        }
    };
    let sent = svc
        .port
        .send(&child.id, &task_prompt(caller, &input.task))
        .await;
    let task = svc.settle_start(task, sent).await?;
    // Again: provisioning the worktree and the first send can take a while,
    // and a Stop landing meanwhile must not leave the new task running.
    if let Err(err) = svc.active_caller(ctx).await {
        let reason = "the caller was stopped while this task was starting";
        svc.cancel_task(task, Some(reason.to_string())).await;
        return Err(err);
    }
    Ok(Created::New(task))
}

pub(super) async fn find_existing(
    svc: &OrchestrationService,
    input: &Input,
    caller: &ChatView,
) -> Result<Option<DelegatedTask>, ToolError> {
    let Some(key) = &input.client_request_id else {
        return Ok(None);
    };
    Ok(svc.tasks.by_request(&caller.id, key).await?)
}

async fn build_request(
    svc: &OrchestrationService,
    input: &Input,
    caller: &ChatView,
) -> Result<LaunchRequest, ToolError> {
    let (adapter_id, model, adapter_auto_mode) = resolve_adapter(
        svc,
        input.adapter_id.as_deref(),
        input.model.as_deref(),
        caller,
    )
    .await?;
    let privileges = resolve_privileges(
        &adapter_id,
        adapter_auto_mode,
        input.permission_mode,
        input.plan_mode,
        caller,
    )?;
    let workspace = resolve_workspace(
        input.workspace.as_ref(),
        WorkspaceMode::Inherit,
        caller,
        &caller.project_id,
    )?;
    let title = input
        .title
        .clone()
        .unwrap_or_else(|| default_title(&input.task));
    Ok(LaunchRequest {
        project_id: caller.project_id.clone(),
        adapter_id,
        model,
        permission_mode: privileges.mode,
        plan_mode: privileges.plan,
        title: Some(title),
        workspace,
        created_by_chat_id: caller.id.clone(),
        parent_chat_id: Some(caller.id.clone()),
    })
}

fn default_title(task: &str) -> String {
    let first = task
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or(task)
        .trim();
    format!("Task: {}", cap_chars(first, 60))
}

async fn record(
    svc: &OrchestrationService,
    input: &Input,
    caller: &ChatView,
    child: &ChatView,
) -> Result<DelegatedTask, ToolError> {
    let parent_depth = svc.tasks.by_child(&caller.id).await?.map_or(0, |t| t.depth);
    let at = now();
    let task = DelegatedTask {
        id: format!("task_{}", child.id),
        parent_chat_id: caller.id.clone(),
        child_chat_id: child.id.clone(),
        client_request_id: input.client_request_id.clone(),
        title: child.title.clone(),
        role: input.role.unwrap_or(TaskRole::General),
        status: TaskStatus::Queued,
        depth: parent_depth + 1,
        summary: None,
        error: None,
        cancel_reason: None,
        delivery: TaskDelivery::Pending,
        created_at: at.clone(),
        updated_at: at,
        completed_at: None,
    };
    svc.tasks.insert(task.clone()).await?;
    Ok(task)
}

/// The child's only message: who delegated it and the task itself.
fn task_prompt(caller: &ChatView, task: &str) -> String {
    let preface = format!(
        "This is a task delegated by chat {} (\"{}\"). Your final reply is returned to it as the task result.",
        caller.id,
        caller.title.as_deref().unwrap_or("untitled")
    );
    wrap_agent_message(
        &caller.id,
        AgentMessageKind::Task,
        &format!("{preface}\n\n{task}"),
    )
}
