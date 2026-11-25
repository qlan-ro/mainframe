//! The one delivery each finished task owes its parent: queued in the outbox,
//! then delivered as a message, read through a tool, or dropped.

use mainframe_types::orchestration::{DelegatedTask, TaskDelivery};

use crate::calls::CallCtx;
use crate::errors::{PortError, ToolError};
use crate::outbox::{OutboxEntry, OutboxKind};
use crate::service::OrchestrationService;
use crate::tasks::now;
use crate::turn_flags::Hold;

impl OrchestrationService {
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
        ctx: &CallCtx,
        mut task: DelegatedTask,
    ) -> Result<DelegatedTask, ToolError> {
        // With nobody left to read the reply, the message still has to come.
        if ctx.abandoned.is_cancelled() {
            return Ok(task);
        }
        if !task.status.is_terminal() || task.delivery != TaskDelivery::Owed {
            return Ok(task);
        }
        self.outbox.drop_task(&task.id);
        task.delivery = TaskDelivery::Acknowledged;
        task.updated_at = now();
        self.save(&task).await?;
        Ok(task)
    }

    /// Records where each task result among `entries` ended up.
    pub(crate) async fn set_delivery(&self, entries: &[OutboxEntry], delivery: TaskDelivery) {
        for entry in entries {
            let OutboxKind::TaskResult { task_id } = &entry.kind else {
                continue;
            };
            if let Err(err) = self.record_delivery(task_id, delivery).await {
                tracing::warn!(task_id, error = %err, "failed to record a task delivery");
            }
        }
    }

    async fn record_delivery(
        &self,
        task_id: &str,
        delivery: TaskDelivery,
    ) -> Result<(), ToolError> {
        let mut task = self.find_task(task_id).await?;
        task.delivery = delivery;
        task.updated_at = now();
        self.save(&task).await
    }

    /// Boot: interrupt what died with the previous daemon, and hold owed
    /// deliveries until each parent spawns again.
    pub async fn reconcile_boot(&self) {
        match self.reconcile_tasks().await {
            Ok((interrupted, owed)) => {
                tracing::info!(interrupted, owed, "delegated tasks reconciled at boot");
            }
            Err(err) => {
                tracing::error!(error = %err, "failed to reconcile delegated tasks at boot");
            }
        }
    }

    async fn reconcile_tasks(&self) -> Result<(usize, usize), PortError> {
        let unfinished = self.tasks.nonterminal().await?;
        let interrupted = self.tasks.interrupt_unfinished().await?;
        for task in &unfinished {
            self.port.chat_changed(&task.parent_chat_id);
            self.port.chat_changed(&task.child_chat_id);
        }
        let owed = self.tasks.owed().await?;
        for task in &owed {
            self.hold(&task.parent_chat_id, Hold::Boot);
            self.queue_delivery(task);
        }
        Ok((interrupted, owed.len()))
    }
}
