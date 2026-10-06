//! `task_status` and `task_cancel`: read (optionally waiting) or stop one of
//! the caller's own delegated tasks.

use std::time::Duration;

use mainframe_types::orchestration::DelegatedTask;
use serde::Deserialize;
use serde_json::{Value, json};

use super::ToolDef;
use crate::errors::{ErrorCode, ToolError};
use crate::input::{
    Validate, check_id, check_opt_id, check_opt_len, check_range, id_schema, object_schema,
    parse_args, string_schema,
};
use crate::policy::{MAX_WAIT_MS, REASON_MAX};
use crate::service::{CallCtx, OrchestrationService};
use crate::tasks::task_not_found;

const LIST_LIMIT: u32 = 50;

pub(super) fn status_definition() -> ToolDef {
    ToolDef {
        name: "task_status",
        title: "Delegated task status",
        description: "Read one of this chat's delegated tasks, optionally waiting up to waitMs for \
            it to finish (returns early when its chat needs a permission answer). Without taskId, \
            list this chat's 50 newest tasks. Reading a finished task here means its result is \
            not sent again as a message.",
        input_schema: object_schema(
            json!({
                "taskId": id_schema("The task to read."),
                "waitMs": { "type": "integer", "minimum": 0, "maximum": MAX_WAIT_MS,
                            "description": "Default 0; only with taskId." }
            }),
            &[],
        ),
        read_only: true,
        destructive: false,
        idempotent: true,
    }
}

pub(super) fn cancel_definition() -> ToolDef {
    ToolDef {
        name: "task_cancel",
        title: "Cancel a delegated task",
        description: "Stop one of this chat's delegated tasks and everything it delegated, \
            deepest first. The child chat is kept for the user to open or continue.",
        input_schema: object_schema(
            json!({
                "taskId": id_schema("The task to cancel."),
                "reason": string_schema(REASON_MAX, "Why, recorded on the task.")
            }),
            &["taskId"],
        ),
        read_only: false,
        destructive: true,
        idempotent: true,
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct StatusInput {
    task_id: Option<String>,
    wait_ms: Option<u64>,
}

impl Validate for StatusInput {
    fn validate(&self) -> Result<(), ToolError> {
        check_opt_id("taskId", self.task_id.as_deref())?;
        if let Some(wait) = self.wait_ms {
            check_range("waitMs", wait, 0, MAX_WAIT_MS)?;
            if wait > 0 && self.task_id.is_none() {
                return Err(ToolError::invalid("waitMs requires taskId"));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CancelInput {
    task_id: String,
    reason: Option<String>,
}

impl Validate for CancelInput {
    fn validate(&self) -> Result<(), ToolError> {
        check_id("taskId", &self.task_id)?;
        check_opt_len("reason", self.reason.as_deref(), REASON_MAX)
    }
}

/// A task of the caller's; another parent's task reads as not found.
async fn own_task(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    task_id: &str,
) -> Result<DelegatedTask, ToolError> {
    match svc.tasks.get(task_id).await {
        Some(task) if task.parent_chat_id == ctx.caller.chat_id => Ok(task),
        _ => Err(task_not_found(task_id)),
    }
}

pub(super) async fn run_status(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    args: Value,
) -> Result<Value, ToolError> {
    let input: StatusInput = parse_args(args)?;
    let Some(task_id) = input.task_id else {
        let mut tasks = Vec::new();
        for task in svc.tasks.by_parent(&ctx.caller.chat_id, LIST_LIMIT).await {
            tasks.push(svc.task_result(&task, None).await);
        }
        return Ok(json!({ "tasks": tasks }));
    };
    own_task(svc, ctx, &task_id).await?;
    let wait = input.wait_ms.unwrap_or(0);
    if wait == 0 {
        let task = svc.advance(&task_id, false).await?;
        let task = svc.acknowledge(task).await?;
        return Ok(svc.task_result(&task, None).await);
    }
    let _slot = ctx.caller.try_begin_wait().ok_or_else(|| {
        ToolError::new(
            ErrorCode::RateLimited,
            "Too many concurrent waits for this chat.",
        )
    })?;
    let (task, returned) = svc
        .wait_task(ctx, &task_id, Duration::from_millis(wait))
        .await?;
    Ok(svc.task_result(&task, Some(returned)).await)
}

pub(super) async fn run_cancel(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    args: Value,
) -> Result<Value, ToolError> {
    let input: CancelInput = parse_args(args)?;
    svc.active_caller(ctx).await?;
    let task = own_task(svc, ctx, &input.task_id).await?;
    let mut cancelled = if task.status.is_terminal() {
        Vec::new()
    } else {
        svc.cancel_task(task, input.reason.clone()).await
    };
    cancelled.retain(|id| *id != input.task_id);
    let task = own_task(svc, ctx, &input.task_id).await?;
    let mut result = svc.task_result(&task, None).await;
    result["cancelledDescendantTaskIds"] = json!(cancelled);
    Ok(result)
}

#[cfg(test)]
#[path = "task_status_tests.rs"]
mod tests;
