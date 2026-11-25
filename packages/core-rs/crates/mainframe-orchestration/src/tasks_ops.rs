//! Task operations the tools share: the Stop cascade, the `TaskResult` shape,
//! and blocking on a task.

use std::time::Duration;

use mainframe_types::orchestration::{DelegatedTask, TaskStatus};
use serde_json::{Value, json};

use crate::calls::CallCtx;
use crate::errors::{PortError, ToolError};
use crate::outcome::Outcome;
use crate::ports::BoxFuture;
use crate::service::OrchestrationService;
use crate::state::ChatState;
use crate::waiter::{WaitEnd, wait_for};

/// Why a blocking task read returned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WaitReturned {
    Terminal,
    WaitingForPermission,
    Timeout,
}

impl WaitReturned {
    fn as_str(self) -> &'static str {
        match self {
            Self::Terminal => "terminal",
            Self::WaitingForPermission => "waiting_for_permission",
            Self::Timeout => "timeout",
        }
    }
}

impl OrchestrationService {
    /// Steps 1–3 of a Stop on `chat_id` (the caller performs step 4, the turn
    /// interrupt): end its in-flight calls and refuse late ones, cancel what
    /// it delegated (deepest first), and drop every message held for it.
    /// Returns the cancelled task ids.
    pub async fn cascade_stop(&self, chat_id: &str, reason: Option<&str>) -> Vec<String> {
        self.begin_stop(chat_id).await;
        let cancelled = self
            .cancel_delegated(chat_id.to_string(), reason.map(str::to_string))
            .await;
        let dropped = self.drop_held_messages(chat_id).await;
        if dropped > 0 || !cancelled.is_empty() {
            tracing::info!(
                chat_id,
                dropped,
                cancelled = cancelled.len(),
                "stop cascaded"
            );
        }
        cancelled
    }

    fn cancel_delegated(
        &self,
        parent: String,
        reason: Option<String>,
    ) -> BoxFuture<'_, Vec<String>> {
        Box::pin(async move {
            let tasks = match self.tasks.by_parent(&parent, u32::MAX).await {
                Ok(tasks) => tasks,
                Err(err) => {
                    tracing::error!(chat_id = parent, error = %err, "failed to read the tasks a Stop must cancel");
                    return Vec::new();
                }
            };
            let mut cancelled = Vec::new();
            for task in tasks.into_iter().filter(|t| !t.status.is_terminal()) {
                cancelled.extend(self.cancel_task(task, reason.clone()).await);
            }
            cancelled
        })
    }

    /// Cancels one task after everything below it. Returns every id cancelled.
    /// A task that finished first keeps its outcome and its delivery.
    pub(crate) async fn cancel_task(
        &self,
        task: DelegatedTask,
        reason: Option<String>,
    ) -> Vec<String> {
        // Recorded first: whatever the Stop below sets off (the child going
        // idle, its prompt still being sent) finds the task already ended.
        let recorded = match self.record_cancelled(&task.id, reason.clone()).await {
            Ok(false) => return Vec::new(),
            Ok(true) => true,
            Err(err) => {
                tracing::warn!(task_id = task.id, error = %err, "failed to record a cancelled task");
                false
            }
        };
        let child = task.child_chat_id;
        // Stopped before the sweep, so the child cannot delegate behind it.
        self.begin_stop(&child).await;
        let mut cancelled = self.cancel_delegated(child.clone(), reason).await;
        self.port.interrupt(&child).await;
        if recorded {
            cancelled.push(task.id);
        }
        cancelled
    }

    /// False when the task was already terminal.
    async fn record_cancelled(
        &self,
        task_id: &str,
        reason: Option<String>,
    ) -> Result<bool, ToolError> {
        let guard = self.task_lock.lock().await;
        let mut task = self.find_task(task_id).await?;
        if task.status.is_terminal() {
            return Ok(false);
        }
        task.cancel_reason = reason;
        let outcome = Outcome {
            status: TaskStatus::Cancelled,
            summary: task.summary.take(),
            error: None,
        };
        self.finalize(&guard, task, outcome).await?;
        Ok(true)
    }

    /// User-facing cancellation, scoped to the task's parent chat: false when
    /// the task is not that chat's.
    pub async fn cancel_task_for_parent(
        &self,
        parent_chat_id: &str,
        task_id: &str,
    ) -> Result<bool, PortError> {
        let task = match self.tasks.get(task_id).await? {
            Some(task) if task.parent_chat_id == parent_chat_id => task,
            _ => return Ok(false),
        };
        if !task.status.is_terminal() {
            self.cancel_task(task, None).await;
        }
        Ok(true)
    }

    /// The `TaskResult` shape.
    pub(crate) async fn task_result(
        &self,
        task: &DelegatedTask,
        returned: Option<WaitReturned>,
    ) -> Result<Value, ToolError> {
        let child = self.port.chat(&task.child_chat_id).await?;
        Ok(json!({
            "taskId": task.id,
            "childChatId": task.child_chat_id,
            "title": task.title,
            "role": task.role,
            "status": task.status,
            "workState": self.work_state(task).await?,
            "adapterId": child.as_ref().map(|c| c.adapter_id.clone()),
            "model": child.as_ref().and_then(|c| c.model.clone()),
            "permissionMode": child.as_ref().map(|c| c.permission_mode),
            "planMode": child.as_ref().map(|c| c.plan_mode),
            "depth": task.depth,
            "summary": task.summary,
            "error": task.error,
            "waitReturned": returned.map(WaitReturned::as_str),
            "createdAt": task.created_at,
            "completedAt": task.completed_at,
        }))
    }

    /// Blocks until the task is terminal, its child waits on a permission
    /// answer, or `timeout` passes. A terminal result read here is
    /// acknowledged, so it is not delivered again as a message.
    pub(crate) async fn wait_task(
        &self,
        ctx: &CallCtx,
        task_id: &str,
        timeout: Duration,
    ) -> Result<(DelegatedTask, WaitReturned), ToolError> {
        let watched = [self.find_task(task_id).await?.child_chat_id];
        let probe = || async {
            let task = self.advance(task_id, false).await.ok()?;
            if task.status.is_terminal() {
                return Some((task, WaitReturned::Terminal));
            }
            let child = self.port.chat(&task.child_chat_id).await.ok().flatten()?;
            (self.state_of(&child) == ChatState::WaitingForPermission)
                .then_some((task, WaitReturned::WaitingForPermission))
        };
        let (task, returned) = match wait_for(self, ctx, timeout, &watched, probe).await {
            WaitEnd::Matched(found) => found,
            WaitEnd::TimedOut => (self.find_task(task_id).await?, WaitReturned::Timeout),
            WaitEnd::Cancelled => return Err(CallCtx::wait_cancelled()),
        };
        Ok((self.acknowledge(ctx, task).await?, returned))
    }
}

#[cfg(test)]
#[path = "tasks_ops_tests.rs"]
mod tests;
