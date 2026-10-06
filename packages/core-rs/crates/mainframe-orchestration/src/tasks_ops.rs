//! Task operations the tools share: the Stop cascade, the active-task
//! limits, the `TaskResult` shape, and blocking on a task.

use std::collections::HashMap;
use std::time::Duration;

use mainframe_types::orchestration::{DelegatedTask, TaskStatus};
use serde_json::{Value, json};

use crate::errors::{ErrorCode, ToolError};
use crate::policy::{MAX_ACTIVE_TASKS_PER_PARENT, MAX_ACTIVE_TASKS_PER_TREE, MAX_DEPTH};
use crate::ports::BoxFuture;
use crate::service::{CallCtx, OrchestrationService};
use crate::state::ChatState;
use crate::tasks::{Outcome, task_not_found};
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
        self.mark_stopping(chat_id);
        let cancelled = self
            .cancel_delegated(chat_id.to_string(), reason.map(str::to_string))
            .await;
        let dropped = self.outbox.drop_for_target(chat_id);
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
            let mut cancelled = Vec::new();
            let open: Vec<DelegatedTask> = self
                .tasks
                .by_parent(&parent, u32::MAX)
                .await
                .into_iter()
                .filter(|t| !t.status.is_terminal())
                .collect();
            for task in open {
                cancelled.extend(self.cancel_task(task, reason.clone()).await);
            }
            cancelled
        })
    }

    /// Cancels one task after everything below it. Returns every id cancelled.
    pub(crate) async fn cancel_task(
        &self,
        mut task: DelegatedTask,
        reason: Option<String>,
    ) -> Vec<String> {
        let child = task.child_chat_id.clone();
        // Untracked first: the interrupt ends the child's turn, and the event
        // loop must not read that as the task finishing on its own.
        self.untrack_child(&child);
        let mut cancelled = self.cancel_delegated(child.clone(), reason.clone()).await;
        self.mark_stopping(&child);
        self.port.interrupt(&child).await;
        self.outbox.drop_task(&task.id);
        let _guard = self.task_lock.lock().await;
        if let Some(fresh) = self.tasks.get(&task.id).await {
            task = fresh;
        }
        let id = task.id.clone();
        if !task.status.is_terminal() {
            task.cancel_reason = reason;
            let outcome = Outcome {
                status: TaskStatus::Cancelled,
                summary: task.summary.take(),
                error: None,
            };
            if let Err(err) = self.finalize(task, outcome).await {
                tracing::warn!(task_id = id, %err, "failed to record a cancelled task");
            }
            cancelled.push(id);
        }
        cancelled
    }

    /// Open tasks in the tree rooted where `chat_id`'s delegation chain starts.
    pub(crate) async fn open_tasks_in_tree(&self, chat_id: &str) -> usize {
        let open = self.tasks.nonterminal().await;
        let parent_of: HashMap<&str, &str> = open
            .iter()
            .map(|t| (t.child_chat_id.as_str(), t.parent_chat_id.as_str()))
            .collect();
        let root = |start: &str| {
            let mut id = start.to_string();
            for _ in 0..=MAX_DEPTH {
                match parent_of.get(id.as_str()) {
                    Some(parent) => id = (*parent).to_string(),
                    None => break,
                }
            }
            id
        };
        let mine = root(chat_id);
        open.iter()
            .filter(|t| root(&t.parent_chat_id) == mine)
            .count()
    }

    pub(crate) async fn check_task_limits(&self, caller_id: &str) -> Result<(), ToolError> {
        let open = self.tasks.nonterminal().await;
        if open
            .iter()
            .filter(|t| t.parent_chat_id == caller_id)
            .count()
            >= MAX_ACTIVE_TASKS_PER_PARENT
        {
            return Err(ToolError::new(
                ErrorCode::TaskLimitExceeded,
                format!(
                    "At most {MAX_ACTIVE_TASKS_PER_PARENT} tasks may run per chat; wait for one to finish."
                ),
            ));
        }
        if self.open_tasks_in_tree(caller_id).await >= MAX_ACTIVE_TASKS_PER_TREE {
            return Err(ToolError::new(
                ErrorCode::TaskLimitExceeded,
                format!(
                    "At most {MAX_ACTIVE_TASKS_PER_TREE} tasks may run in one delegation tree."
                ),
            ));
        }
        Ok(())
    }

    /// The `TaskResult` shape.
    pub(crate) async fn task_result(
        &self,
        task: &DelegatedTask,
        returned: Option<WaitReturned>,
    ) -> Value {
        let child = self.port.chat(&task.child_chat_id).await;
        json!({
            "taskId": task.id,
            "childChatId": task.child_chat_id,
            "title": task.title,
            "role": task.role,
            "status": task.status,
            "workState": self.work_state(task).await,
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
        })
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
        let task = self
            .tasks
            .get(task_id)
            .await
            .ok_or_else(|| task_not_found(task_id))?;
        let watched = [task.child_chat_id.clone()];
        let probe = || async {
            let task = self.advance(task_id, false).await.ok()?;
            if task.status.is_terminal() {
                return Some((task, WaitReturned::Terminal));
            }
            let child = self.port.chat(&task.child_chat_id).await?;
            (self.state_of(&child) == ChatState::WaitingForPermission)
                .then_some((task, WaitReturned::WaitingForPermission))
        };
        let (task, returned) = match wait_for(self, ctx, timeout, &watched, probe).await {
            WaitEnd::Matched(found) => found,
            WaitEnd::TimedOut => {
                let task = self
                    .tasks
                    .get(task_id)
                    .await
                    .ok_or_else(|| task_not_found(task_id))?;
                (task, WaitReturned::Timeout)
            }
            WaitEnd::Cancelled => {
                return Err(ToolError::new(
                    ErrorCode::CallerNotActive,
                    "The wait was cancelled because the calling turn stopped.",
                ));
            }
        };
        Ok((self.acknowledge(task).await?, returned))
    }
}
