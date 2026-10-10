//! Delegated-task state: advancing a task from its child chat's state,
//! finalizing it once, and owing the parent exactly one delivery.
//!
//! A task is terminal only when its child is idle with nothing queued and
//! nothing it delegated is still open. Once terminal, its summary is fixed:
//! later messages to the child never reopen it.

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::events::DaemonEvent;
use mainframe_types::orchestration::{DelegatedTask, TaskDelivery, TaskStatus, TaskWorkState};

use crate::errors::{ErrorCode, ToolError, cap_chars};
use crate::outbox::OutboxKind;
use crate::policy::SUMMARY_CAP;
use crate::service::OrchestrationService;
use crate::state::{ChatState, last_assistant_text};

/// How a terminal task ended, and what the parent is told.
pub(crate) struct Outcome {
    pub status: TaskStatus,
    pub summary: Option<String>,
    pub error: Option<String>,
}

impl Outcome {
    /// An ending with nothing to summarize, only a reason.
    pub(crate) fn without_summary(status: TaskStatus, error: &str) -> Self {
        Self {
            status,
            summary: None,
            error: Some(error.to_string()),
        }
    }
}

/// The daemon's timestamp shape (`2026-10-06T12:00:00.000Z`).
pub(crate) fn now() -> String {
    mainframe_types::time::now_iso8601()
}

/// What a finished child reports: a failed last turn leads with its error.
fn idle_outcome(messages: &[ChatMessage]) -> Outcome {
    let summary =
        Some(cap_chars(&last_assistant_text(messages), SUMMARY_CAP)).filter(|s| !s.is_empty());
    let error = messages
        .last()
        .filter(|m| m.r#type == ChatMessageType::Error)
        .map(|m| {
            m.content
                .iter()
                .filter_map(|c| match c {
                    MessageContent::Node(MessageContentNode::Error { message, .. }) => {
                        Some(message.as_str())
                    }
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n")
        });
    match error {
        Some(error) => Outcome {
            status: TaskStatus::Failed,
            summary,
            error: Some(error),
        },
        None => Outcome {
            status: TaskStatus::Completed,
            summary,
            error: None,
        },
    }
}

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

    pub(crate) fn track_child(&self, task: &DelegatedTask) {
        self.lock_children()
            .insert(task.child_chat_id.clone(), task.id.clone());
    }

    pub(crate) fn untrack_child(&self, child_chat_id: &str) {
        self.lock_children().remove(child_chat_id);
    }

    pub(crate) fn tracked_task(&self, child_chat_id: &str) -> Option<String> {
        self.lock_children().get(child_chat_id).cloned()
    }

    fn lock_children(
        &self,
    ) -> std::sync::MutexGuard<'_, std::collections::HashMap<String, String>> {
        self.active_children
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    async fn has_open_subtasks(&self, chat_id: &str) -> bool {
        self.tasks
            .by_parent(chat_id, u32::MAX)
            .await
            .iter()
            .any(|t| !t.status.is_terminal())
    }

    /// Re-reads the child and moves the task forward. `interrupted` is set when
    /// the child's turn just ended on the user's Stop. Returns the task as stored.
    pub(crate) async fn advance(
        &self,
        task_id: &str,
        interrupted: bool,
    ) -> Result<DelegatedTask, ToolError> {
        let _guard = self.task_lock.lock().await;
        let mut task = self
            .tasks
            .get(task_id)
            .await
            .ok_or_else(|| task_not_found(task_id))?;
        if task.status.is_terminal() || self.tracked_task(&task.child_chat_id).is_none() {
            return Ok(task);
        }
        let Some(child) = self.port.chat(&task.child_chat_id).await else {
            let gone = Outcome::without_summary(TaskStatus::Failed, "The task's chat was deleted.");
            return self.finalize(task, gone).await;
        };
        let next = match self.state_of(&child) {
            ChatState::Ended | ChatState::Archived => {
                let closed = Outcome::without_summary(
                    TaskStatus::Interrupted,
                    "The task's chat was closed.",
                );
                return self.finalize(task, closed).await;
            }
            _ if interrupted => {
                let messages = self.port.messages(&child.id).await;
                let mut stopped = idle_outcome(&messages);
                stopped.status = TaskStatus::Interrupted;
                return self.finalize(task, stopped).await;
            }
            ChatState::WaitingForPermission => TaskStatus::Waiting,
            ChatState::Working => TaskStatus::Running,
            ChatState::Idle if self.has_open_subtasks(&child.id).await => TaskStatus::Running,
            ChatState::Idle => {
                let messages = self.port.messages(&child.id).await;
                return self.finalize(task, idle_outcome(&messages)).await;
            }
        };
        if next != task.status {
            task.status = next;
            task.updated_at = now();
            self.save(&task).await?;
        }
        Ok(task)
    }

    /// Makes `task` terminal and owes the parent its delivery (dropped for a
    /// cancellation, which the parent asked for itself).
    pub(crate) async fn finalize(
        &self,
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
        self.untrack_child(&task.child_chat_id);
        self.save(&task).await?;
        if task.delivery == TaskDelivery::Owed {
            self.queue_delivery(&task);
            self.try_flush(&task.parent_chat_id).await;
        }
        tracing::info!(
            task_id = task.id,
            status = task.status.as_str(),
            "delegated task finished"
        );
        Ok(task)
    }

    pub(crate) fn queue_delivery(&self, task: &DelegatedTask) {
        let text = task
            .error
            .as_deref()
            .into_iter()
            .chain(task.summary.as_deref())
            .collect::<Vec<_>>()
            .join("\n\n");
        let body = format!(
            "<mainframe-task-result task=\"{}\" chat=\"{}\" status=\"{}\">\n{text}\n</mainframe-task-result>",
            task.id,
            task.child_chat_id,
            task.status.as_str()
        );
        let kind = OutboxKind::TaskResult {
            task_id: task.id.clone(),
        };
        self.outbox
            .push(&task.parent_chat_id, &task.child_chat_id, kind, body, &text);
    }

    /// The parent read the terminal result through a tool, so the message
    /// delivery is no longer owed.
    pub(crate) async fn acknowledge(
        &self,
        mut task: DelegatedTask,
    ) -> Result<DelegatedTask, ToolError> {
        if !task.status.is_terminal() || task.delivery != TaskDelivery::Owed {
            return Ok(task);
        }
        self.outbox.drop_task(&task.id);
        task.delivery = TaskDelivery::Acknowledged;
        task.updated_at = now();
        self.save(&task).await?;
        Ok(task)
    }

    pub(crate) async fn work_state(&self, task: &DelegatedTask) -> TaskWorkState {
        if task.status.is_terminal() {
            return TaskWorkState::ResultAvailable;
        }
        if self.has_open_subtasks(&task.child_chat_id).await {
            TaskWorkState::WaitingForChildren
        } else {
            TaskWorkState::Working
        }
    }

    /// Boot: interrupt what died with the previous daemon, and hold owed
    /// deliveries until each parent spawns again.
    pub async fn reconcile_boot(&self) {
        let interrupted = self.tasks.interrupt_unfinished().await;
        let owed = self.tasks.owed().await;
        for task in &owed {
            self.boot_held
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(task.parent_chat_id.clone());
            self.queue_delivery(task);
        }
        tracing::info!(
            interrupted,
            owed = owed.len(),
            "delegated tasks reconciled at boot"
        );
    }

    pub(crate) fn is_boot_held(&self, chat_id: &str) -> bool {
        self.boot_held
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains(chat_id)
    }
}

pub(crate) fn task_not_found(task_id: &str) -> ToolError {
    ToolError::new(ErrorCode::TaskNotFound, format!("No task {task_id}."))
}
