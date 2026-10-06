//! `delegate_task`: a child chat with lineage that runs one task prompt. The
//! child gets only the prompt; its result comes back as a tool result (wait
//! mode) or as one message once the parent is idle (async mode).

use std::time::Duration;

use mainframe_types::orchestration::{DelegatedTask, TaskDelivery, TaskRole, TaskStatus};
use mainframe_types::settings::ExecutionMode;
use serde::Deserialize;
use serde_json::{Value, json};

use super::ToolDef;
use super::launch_common::{
    admit_creation, resolve_adapter, resolve_privileges, resolve_workspace,
};
use crate::errors::{ErrorCode, ToolError, cap_chars};
use crate::input::{
    Validate, WorkspaceInput, WorkspaceMode, check_opt_id, check_opt_len, check_text,
    check_timeout, id_schema, object_schema, parse_args, permission_mode_schema, string_schema,
    text_schema, timeout_schema, workspace_schema,
};
use crate::policy::{DEFAULT_WAIT_MS, TITLE_MAX};
use crate::ports::{ChatView, LaunchRequest};
use crate::service::{CallCtx, OrchestrationService};
use crate::state::{AgentMessageKind, wrap_agent_message};
use crate::tasks::now;

pub(super) fn definition() -> ToolDef {
    ToolDef {
        name: "delegate_task",
        title: "Delegate a task",
        description: "Start a child chat that runs one task and reports back. The child receives \
            only the task text, so include everything it needs. Defaults: the caller's adapter, \
            model, modes, and working directory (workspace inherit); new_worktree gives it its \
            own worktree. mode async (default) returns at once and the result arrives later as a \
            message in this chat: end your turn instead of polling. mode wait blocks until the \
            task finishes, the child needs a permission answer, or timeoutMs passes. Reuse \
            clientRequestId when retrying so the task is not started twice.",
        input_schema: object_schema(
            json!({
                "task": text_schema("The complete task prompt."),
                "title": string_schema(TITLE_MAX, "Child chat title."),
                "role": { "enum": ["implementation", "research", "review", "design", "test", "general"] },
                "adapterId": id_schema("Adapter id from capabilities."),
                "model": string_schema(200, "Model id from capabilities."),
                "permissionMode": permission_mode_schema(),
                "planMode": { "type": "boolean" },
                "workspace": workspace_schema(&["inherit", "new_worktree"], "Default inherit."),
                "mode": { "enum": ["async", "wait"], "description": "Default async." },
                "timeoutMs": timeout_schema("Wait mode only. Default 600000."),
                "clientRequestId": id_schema("Idempotency key, unique per caller.")
            }),
            &["task"],
        ),
        read_only: false,
        destructive: false,
        idempotent: false,
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Mode {
    #[default]
    Async,
    Wait,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Input {
    task: String,
    title: Option<String>,
    role: Option<TaskRole>,
    adapter_id: Option<String>,
    model: Option<String>,
    permission_mode: Option<ExecutionMode>,
    plan_mode: Option<bool>,
    workspace: Option<WorkspaceInput>,
    #[serde(default)]
    mode: Mode,
    timeout_ms: Option<u64>,
    client_request_id: Option<String>,
}

impl Validate for Input {
    fn validate(&self) -> Result<(), ToolError> {
        check_text("task", &self.task)?;
        check_opt_len("title", self.title.as_deref(), TITLE_MAX)?;
        check_opt_id("adapterId", self.adapter_id.as_deref())?;
        check_opt_len("model", self.model.as_deref(), 200)?;
        check_opt_id("clientRequestId", self.client_request_id.as_deref())?;
        check_timeout("timeoutMs", self.timeout_ms)?;
        if let Some(workspace) = &self.workspace {
            workspace.validate()?;
            if !matches!(
                workspace.mode,
                WorkspaceMode::Inherit | WorkspaceMode::NewWorktree
            ) {
                return Err(ToolError::invalid(
                    "workspace.mode must be inherit or new_worktree",
                ));
            }
        }
        Ok(())
    }
}

pub(super) async fn run(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    args: Value,
) -> Result<Value, ToolError> {
    let input: Input = parse_args(args)?;
    let caller = svc.active_caller(ctx).await?;
    if let Some(key) = &input.client_request_id
        && let Some(existing) = svc.tasks.by_request(&caller.id, key).await
    {
        return Ok(svc.task_result(&existing, None).await);
    }
    let request = build_request(svc, &input, &caller).await?;
    svc.check_task_limits(&caller.id).await?;
    // Claimed before anything is created, so a refused wait starts nothing.
    let slot = match input.mode {
        Mode::Wait => Some(ctx.caller.try_begin_wait().ok_or_else(|| {
            ToolError::new(
                ErrorCode::RateLimited,
                "Too many concurrent waits for this chat.",
            )
        })?),
        Mode::Async => None,
    };
    admit_creation(svc, &caller).await?;
    let child = svc.port.launch_chat(request).await?;
    let task = start(svc, &input, &caller, &child).await?;
    if slot.is_none() {
        return Ok(svc.task_result(&task, None).await);
    }
    let timeout = Duration::from_millis(input.timeout_ms.unwrap_or(DEFAULT_WAIT_MS));
    let (task, returned) = svc.wait_task(ctx, &task.id, timeout).await?;
    Ok(svc.task_result(&task, Some(returned)).await)
}

async fn build_request(
    svc: &OrchestrationService,
    input: &Input,
    caller: &ChatView,
) -> Result<LaunchRequest, ToolError> {
    let (adapter_id, model) = resolve_adapter(
        svc,
        input.adapter_id.as_deref(),
        input.model.as_deref(),
        caller,
    )
    .await?;
    let privileges = resolve_privileges(input.permission_mode, input.plan_mode, caller)?;
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

/// Records the task, then sends the child its only message.
async fn start(
    svc: &OrchestrationService,
    input: &Input,
    caller: &ChatView,
    child: &ChatView,
) -> Result<DelegatedTask, ToolError> {
    let parent_depth = svc.tasks.by_child(&caller.id).await.map_or(0, |t| t.depth);
    let at = now();
    let mut task = DelegatedTask {
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
    let body = task_prompt(caller, &input.task);
    if let Err(err) = svc.port.send(&child.id, &body).await {
        let failure = crate::tasks::Outcome::without_summary(
            TaskStatus::Failed,
            "The task prompt could not be delivered.",
        );
        tracing::warn!(task_id = task.id, ?err, "delegated task prompt failed");
        return svc.finalize(task, failure).await;
    }
    task.status = TaskStatus::Running;
    task.updated_at = now();
    svc.save(&task).await?;
    svc.track_child(&task);
    // Catches a child that finished before it was tracked.
    svc.advance(&task.id, false).await
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

#[cfg(test)]
#[path = "delegate_task_tests.rs"]
pub(crate) mod tests;
