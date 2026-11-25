//! The service's reactions to chat lifecycle: task progress, outbox flushes,
//! and credential revocation on exit.

use std::sync::Arc;

use mainframe_types::events::{ChatUpdatedReason, DaemonEvent};
use mainframe_types::orchestration::{AgentOutboxEntry, TaskDelivery};
use tokio::sync::broadcast::error::RecvError;

use crate::service::OrchestrationService;
use crate::waiter::event_chat_id;

impl OrchestrationService {
    /// What Mainframe is holding for `chat_id`, oldest first, as the
    /// target's `Chat.agent_outbox` shows it.
    #[must_use]
    pub fn agent_outbox(&self, chat_id: &str) -> Vec<AgentOutboxEntry> {
        self.outbox
            .list_for(chat_id)
            .into_iter()
            .map(|e| AgentOutboxEntry {
                entry_id: e.entry_id,
                from_chat_id: e.from_chat_id,
                preview: e.preview,
            })
            .collect()
    }

    /// The user's cancel on one held message; a cancelled task result is
    /// recorded as dropped. False when the entry is gone (already sent).
    pub async fn cancel_outbox_entry(&self, chat_id: &str, entry_id: &str) -> bool {
        let Some(entry) = self.outbox.cancel(chat_id, entry_id) else {
            return false;
        };
        self.set_delivery(&[entry], TaskDelivery::Dropped).await;
        true
    }

    /// Reacts to one daemon event. Public so the server can drive it from
    /// its own broadcast pump in tests.
    pub async fn on_event(&self, event: &DaemonEvent) {
        match event {
            DaemonEvent::ProcessStopped { process_id } if !process_id.is_empty() => {
                self.credentials().revoke_by_session_id(process_id);
            }
            DaemonEvent::ChatEnded { chat_id } | DaemonEvent::ChatOffloaded { chat_id } => {
                self.revoke(chat_id);
            }
            // Our own announcements; reacting would only re-read the same task.
            DaemonEvent::DelegatedTaskUpdated { .. } => return,
            _ => {}
        }
        let Some(chat_id) = event_chat_id(event) else {
            return;
        };
        if let Some(task_id) = self.tracked_task(chat_id) {
            let interrupted = matches!(
                event,
                DaemonEvent::ChatUpdated {
                    reason: Some(ChatUpdatedReason::Interrupted),
                    ..
                }
            );
            self.advance_or_warn(&task_id, interrupted).await;
        }
        // After advancing, which reads the stopping flag.
        self.settle_turn(chat_id).await;
        self.try_flush(chat_id).await;
    }

    async fn on_lagged(&self) {
        for task_id in self.tracked_tasks() {
            self.advance_or_warn(&task_id, false).await;
        }
        for chat_id in self.unsettled() {
            self.settle_turn(&chat_id).await;
        }
        for target in self.outbox.targets() {
            self.try_flush(&target).await;
        }
    }

    async fn advance_or_warn(&self, task_id: &str, interrupted: bool) {
        if let Err(err) = self.advance(task_id, interrupted).await {
            tracing::warn!(task_id, error = %err, "failed to advance a delegated task");
        }
    }

    /// Drives [`Self::on_event`] from the daemon broadcast until it closes.
    pub fn spawn_event_loop(self: &Arc<Self>) -> tokio::task::JoinHandle<()> {
        let svc = Arc::clone(self);
        let mut rx = svc.port.subscribe();
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(event) => svc.on_event(&event).await,
                    Err(RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "orchestration event loop lagged");
                        svc.on_lagged().await;
                    }
                    Err(RecvError::Closed) => break,
                }
            }
        })
    }
}

#[cfg(test)]
#[path = "lifecycle_tests.rs"]
mod tests;
