//! `delegate_task`: a child chat with lineage that runs one task prompt. The
//! child gets only the prompt; its result comes back as a tool result (wait
//! mode) or as one message once the parent is idle (async mode).

use std::time::Duration;

use mainframe_types::orchestration::{DelegatedTask, TaskRole};
use mainframe_types::settings::ExecutionMode;
use serde::Deserialize;
use serde_json::{Value, json};

use super::ToolDef;
use crate::calls::CallCtx;
use crate::errors::ToolError;
use crate::input::{
    Validate, WorkspaceInput, WorkspaceMode, check_opt_id, check_opt_len, check_text,
    check_timeout, id_schema, object_schema, parse_args, permission_mode_schema, string_schema,
    text_schema, timeout_schema, workspace_schema,
};
use crate::policy::{DEFAULT_WAIT_MS, MAX_SINGLE_WAIT_MS, TITLE_MAX};
use crate::service::OrchestrationService;

mod create;

use create::{Created, create, find_existing};

pub(super) fn definition() -> ToolDef {
    ToolDef {
        title: "Delegate a task",
        description: "Start a child chat that runs one task and reports back. Use this, not a \
            plugin or built-in subagent, when the user asks to spawn, start or delegate to a \
            Claude or Codex agent; set adapterId to the provider they named. The child receives \
            only the task text, so include everything it needs. Defaults: the caller's adapter, \
            model, modes, and working directory (workspace inherit); new_worktree gives it its \
            own worktree. mode async (default) returns at once and the result arrives later as a \
            message in this chat: end your turn instead of polling. mode wait blocks until the \
            task finishes, the child needs a permission answer, or timeoutMs passes, but each \
            call actually blocks for well under a minute: waitReturned timeout before timeoutMs \
            has elapsed does not cancel the task, call task_status with the returned taskId to \
            keep waiting. Reuse clientRequestId when retrying so the task is not started twice.",
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
    // Before claiming a wait slot: a retry may not need a new one, since the
    // task it asks for is already there.
    if let Some(existing) = find_existing(svc, &input, &caller).await? {
        return retried(svc, ctx, existing).await;
    }
    // Claimed before anything is created, so a refused wait starts nothing.
    let slot = match input.mode {
        Mode::Wait => Some(ctx.caller.begin_wait()?),
        Mode::Async => None,
    };
    let task = match create(svc, ctx, &input, &caller).await? {
        Created::New(task) => task,
        Created::Existing(task) => return retried(svc, ctx, task).await,
    };
    if slot.is_none() {
        return svc.task_result(&task, None).await;
    }
    // Capped well under a minute per call regardless of timeoutMs: see
    // `policy::MAX_SINGLE_WAIT_MS`.
    let timeout = Duration::from_millis(input.timeout_ms.unwrap_or(DEFAULT_WAIT_MS))
        .min(Duration::from_millis(MAX_SINGLE_WAIT_MS));
    let (task, returned) = svc.wait_task(ctx, &task.id, timeout).await?;
    svc.task_result(&task, Some(returned)).await
}

/// A retry reads the task like `task_status` does: a finished result returned
/// here is not sent again as a message.
async fn retried(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    task: DelegatedTask,
) -> Result<Value, ToolError> {
    let task = svc.acknowledge(ctx, task).await?;
    svc.task_result(&task, None).await
}

#[cfg(test)]
#[path = "delegate_task_tests.rs"]
mod tests;
