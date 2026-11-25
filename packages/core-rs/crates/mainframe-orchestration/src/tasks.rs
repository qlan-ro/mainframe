//! Delegated-task state: advancing a task from its child chat's state,
//! finalizing it once, and owing the parent exactly one delivery.
//!
//! A task is terminal only when its child is idle with nothing queued and
//! nothing it delegated is still open. Once terminal, its summary is fixed:
//! later messages to the child never reopen it.

use mainframe_types::events::DaemonEvent;
use mainframe_types::orchestration::{DelegatedTask, TaskDelivery, TaskStatus, TaskWorkState};
use mainframe_types::sync::LockExt as _;

use crate::errors::{ErrorCode, PortError, ToolError};
use crate::outcome::{Outcome, idle_outcome};
use crate::service::OrchestrationService;
use crate::state::ChatState;

/// The daemon's timestamp shape (`2026-10-06T12:00:00.000Z`).
pub(crate) fn now() -> String {
    mainframe_types::time::now_iso8601()
}

/// Proof that the caller holds [`OrchestrationService::task_lock`].
pub(crate) type TaskGuard<'a> = tokio::sync::MutexGuard<'a, ()>;

impl OrchestrationService {
    /// Persists and announces a task change, on its own event and on both
    /// chats whose derived fields read it (the child's `delegation`, the
    /// parent's `delegated_waiting`).
    pub(crate) async fn save(&self, task: &DelegatedTask) -> Result<(), ToolError> {
        self.tasks.update(task.clone()).await?;
        self.port
            .emit(DaemonEvent::DelegatedTaskUpdated { task: task.clone() });
        self.port.chat_changed(&task.parent_chat_id);
        self.port.chat_changed(&task.child_chat_id);
        Ok(())
    }

    fn track_child(&self, task: &DelegatedTask) {
        self.active_children
            .lock_recover()
            .insert(task.child_chat_id.clone(), task.id.clone());
    }

    fn untrack_child(&self, child_chat_id: &str) {
        self.active_children.lock_recover().remove(child_chat_id);
    }

    pub(crate) fn tracked_task(&self, child_chat_id: &str) -> Option<String> {
        self.active_children
            .lock_recover()
            .get(child_chat_id)
            .cloned()
    }

    pub(crate) fn tracked_tasks(&self) -> Vec<String> {
        self.active_children
            .lock_recover()
            .values()
            .cloned()
            .collect()
    }

    pub(crate) async fn find_task(&self, task_id: &str) -> Result<DelegatedTask, ToolError> {
        let task = self.tasks.get(task_id).await?;
        task.ok_or_else(|| task_not_found(task_id))
    }

    async fn has_open_subtasks(&self, chat_id: &str) -> Result<bool, ToolError> {
        let tasks = self.tasks.by_parent(chat_id, u32::MAX).await?;
        Ok(tasks.iter().any(|t| !t.status.is_terminal()))
    }

    /// Moves a recorded task to running (or failed) once its prompt was sent,
    /// unless it was cancelled meanwhile: a cancelled task stays cancelled, and
    /// the turn the prompt just started is stopped.
    pub(crate) async fn settle_start(
        &self,
        task: DelegatedTask,
        sent: Result<(), PortError>,
    ) -> Result<DelegatedTask, ToolError> {
        let (task, cancelled) = {
            let guard = self.task_lock.lock().await;
            // Tracked whatever fails below: the row is open and the child runs,
            // so the child's next event gets to try again.
            self.track_child(&task);
            let mut task = self.find_task(&task.id).await?;
            let cancelled = task.status.is_terminal();
            match &sent {
                _ if cancelled => self.untrack_child(&task.child_chat_id),
                Err(err) => {
                    tracing::warn!(
                        chat_id = task.child_chat_id,
                        task_id = task.id,
                        error = %err,
                        "delegated task prompt failed"
                    );
                    let failed = Outcome::without_summary(
                        TaskStatus::Failed,
                        "The task prompt could not be delivered.",
                    );
                    task = self.finalize(&guard, task, failed).await?;
                }
                Ok(()) => {
                    task.status = TaskStatus::Running;
                    task.updated_at = now();
                    self.save(&task).await?;
                }
            }
            (task, cancelled)
        };
        if !cancelled {
            // Catches a child that finished before it was tracked.
            return self.advance(&task.id, false).await;
        }
        if sent.is_ok() {
            self.begin_stop(&task.child_chat_id).await;
            self.port.interrupt(&task.child_chat_id).await;
        }
        Ok(task)
    }

    /// Ends the task running in `child_chat_id`, if any, because the results it
    /// waits for could not be delivered: it would otherwise stay open, held,
    /// with nothing left to wake it. Returns the parent it now owes.
    pub(crate) async fn fail_undeliverable(
        &self,
        child_chat_id: &str,
    ) -> Result<Option<String>, ToolError> {
        let Some(task_id) = self.tracked_task(child_chat_id) else {
            return Ok(None);
        };
        let guard = self.task_lock.lock().await;
        let task = self.find_task(&task_id).await?;
        if task.status.is_terminal() {
            return Ok(None);
        }
        let failed = Outcome::without_summary(
            TaskStatus::Failed,
            "A message the task was waiting for could not be delivered to its chat.",
        );
        let task = self.finalize(&guard, task, failed).await?;
        Ok(Some(task.parent_chat_id))
    }

    /// Re-reads the child and moves the task forward. `interrupted` is set when
    /// the child's turn just ended on the user's Stop. Returns the task as stored.
    pub(crate) async fn advance(
        &self,
        task_id: &str,
        interrupted: bool,
    ) -> Result<DelegatedTask, ToolError> {
        let task = {
            let guard = self.task_lock.lock().await;
            self.advance_locked(&guard, task_id, interrupted).await?
        };
        // Outside the lock: a delivery may have to start the parent's CLI.
        if task.delivery == TaskDelivery::Owed {
            self.try_flush(&task.parent_chat_id).await;
        }
        Ok(task)
    }

    async fn advance_locked(
        &self,
        guard: &TaskGuard<'_>,
        task_id: &str,
        interrupted: bool,
    ) -> Result<DelegatedTask, ToolError> {
        let mut task = self.find_task(task_id).await?;
        if task.status.is_terminal() || self.tracked_task(&task.child_chat_id).is_none() {
            return Ok(task);
        }
        let Some(child) = self.port.chat(&task.child_chat_id).await? else {
            let gone = Outcome::without_summary(TaskStatus::Failed, "The task's chat was deleted.");
            return self.finalize(guard, task, gone).await;
        };
        let state = self.state_of(&child);
        let next = match state {
            ChatState::Ended | ChatState::Archived => {
                let closed = Outcome::without_summary(
                    TaskStatus::Interrupted,
                    "The task's chat was closed.",
                );
                return self.finalize(guard, task, closed).await;
            }
            // A waiting tool call sees the same idle chat the event loop does,
            // but not the event's reason: the stopping flag, which the loop
            // clears only after advancing, tells a Stop from a finished turn.
            _ if interrupted || (state == ChatState::Idle && self.is_stopping(&child.id)) => {
                let messages = self.port.messages(&child.id).await;
                let stopped = Outcome {
                    status: TaskStatus::Interrupted,
                    ..idle_outcome(&messages)
                };
                return self.finalize(guard, task, stopped).await;
            }
            ChatState::WaitingForPermission => TaskStatus::Waiting,
            ChatState::Working => TaskStatus::Running,
            ChatState::Idle if self.has_open_subtasks(&child.id).await? => TaskStatus::Running,
            ChatState::Idle => {
                let messages = self.port.messages(&child.id).await;
                return self.finalize(guard, task, idle_outcome(&messages)).await;
            }
        };
        if next != task.status {
            task.status = next;
            task.updated_at = now();
            self.save(&task).await?;
        }
        Ok(task)
    }

    /// Makes `task` terminal and queues the delivery it owes the parent (none
    /// for a cancellation, which the parent asked for itself). The caller
    /// flushes the parent once it has released the lock.
    pub(crate) async fn finalize(
        &self,
        _guard: &TaskGuard<'_>,
        mut task: DelegatedTask,
        outcome: Outcome,
    ) -> Result<DelegatedTask, ToolError> {
        let at = now();
        task.status = outcome.status;
        task.summary = outcome.summary;
        task.error = outcome.error;
        task.updated_at = at.clone();
        task.completed_at = Some(at);
        task.delivery = if task.status == TaskStatus::Cancelled {
            TaskDelivery::Dropped
        } else {
            TaskDelivery::Owed
        };
        // Saved before it is untracked: an unsaved ending leaves the row open,
        // so the child's next event has to try again.
        self.save(&task).await?;
        self.untrack_child(&task.child_chat_id);
        if task.delivery == TaskDelivery::Owed {
            self.queue_delivery(&task);
        }
        tracing::info!(
            chat_id = task.child_chat_id,
            task_id = task.id,
            status = task.status.as_str(),
            "delegated task finished"
        );
        Ok(task)
    }

    pub(crate) async fn work_state(
        &self,
        task: &DelegatedTask,
    ) -> Result<TaskWorkState, ToolError> {
        Ok(if task.status.is_terminal() {
            TaskWorkState::ResultAvailable
        } else if self.has_open_subtasks(&task.child_chat_id).await? {
            TaskWorkState::WaitingForChildren
        } else {
            TaskWorkState::Working
        })
    }
}

pub(crate) fn task_not_found(task_id: &str) -> ToolError {
    ToolError::new(ErrorCode::TaskNotFound, format!("No task {task_id}."))
}

#[cfg(test)]
#[path = "tasks_tests.rs"]
mod tests;
