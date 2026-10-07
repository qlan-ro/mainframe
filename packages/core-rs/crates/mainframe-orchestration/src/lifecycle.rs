//! The service's reactions to chat lifecycle: task progress, outbox
//! flushes when a target goes idle, and credential revocation on exit.

use std::sync::Arc;

use mainframe_types::events::{ChatUpdatedReason, DaemonEvent};
use mainframe_types::orchestration::{AgentOutboxEntry, TaskDelivery};
use tokio::sync::broadcast::error::RecvError;

use crate::outbox::{OutboxEntry, OutboxKind, batch_body};
use crate::service::OrchestrationService;
use crate::state::ChatState;
use crate::tasks::now;
use crate::waiter::event_chat_id;

impl OrchestrationService {
    /// Sends everything held for `chat_id` as one message once it is idle.
    /// Deliveries a restart left owed wait until the chat spawns again.
    pub async fn try_flush(&self, chat_id: &str) {
        if !self.outbox.has_for(chat_id) || self.is_boot_held(chat_id) {
            return;
        }
        let _guard = self.flush_lock.lock().await;
        let Some(chat) = self.port.chat(chat_id).await else {
            self.outbox.drop_for_target(chat_id);
            return;
        };
        match crate::state::derive_state(&chat, false) {
            ChatState::Idle => {}
            ChatState::Ended | ChatState::Archived => {
                self.outbox.drop_for_target(chat_id);
                return;
            }
            _ => return,
        }
        let entries = self.outbox.take_for(chat_id);
        if entries.is_empty() {
            return;
        }
        if let Err(err) = self.port.send(chat_id, &batch_body(&entries)).await {
            tracing::warn!(chat_id, ?err, "outbox delivery failed; keeping entries");
            self.outbox.restore(entries);
            return;
        }
        self.set_delivery(&entries, TaskDelivery::Delivered).await;
    }

    /// Records where each task result among `entries` ended up.
    async fn set_delivery(&self, entries: &[OutboxEntry], delivery: TaskDelivery) {
        for entry in entries {
            let OutboxKind::TaskResult { task_id } = &entry.kind else {
                continue;
            };
            let Some(mut task) = self.tasks.get(task_id).await else {
                continue;
            };
            task.delivery = delivery;
            task.updated_at = now();
            if let Err(err) = self.save(&task).await {
                tracing::warn!(task_id, %err, "failed to record a task delivery");
            }
        }
    }

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
        let entry = self
            .outbox
            .list_for(chat_id)
            .into_iter()
            .find(|e| e.entry_id == entry_id);
        let Some(entry) = entry else {
            return false;
        };
        if !self.outbox.cancel(chat_id, entry_id) {
            return false;
        }
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
        // Only a stopped chat needs the re-read; most events skip the port.
        if self.is_stopping(chat_id) && self.port.chat(chat_id).await.is_some_and(|c| !c.working) {
            self.clear_stopping(chat_id);
        }
        if let Some(task_id) = self.tracked_task(chat_id) {
            let interrupted = matches!(
                event,
                DaemonEvent::ChatUpdated {
                    reason: Some(ChatUpdatedReason::Interrupted),
                    ..
                }
            );
            if let Err(err) = self.advance(&task_id, interrupted).await {
                tracing::warn!(task_id, %err, "failed to advance a delegated task");
            }
        }
        self.try_flush(chat_id).await;
    }

    async fn on_lagged(&self) {
        let tracked: Vec<String> = self
            .active_children
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .cloned()
            .collect();
        for task_id in tracked {
            if let Err(err) = self.advance(&task_id, false).await {
                tracing::warn!(task_id, %err, "failed to advance a delegated task");
            }
        }
        for target in self.outbox.targets() {
            self.try_flush(&target).await;
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
mod tests {
    use super::*;
    use crate::outbox::OutboxKind;
    use crate::test_support::{FakePort, service_with};

    #[tokio::test]
    async fn held_messages_flush_as_one_batch_only_when_idle() {
        let port = FakePort::new();
        let mut target = port.add_chat("target");
        target.working = true;
        port.put(target);
        port.add_chat("caller");
        let (svc, _ctx) = service_with(port.clone(), "caller");
        svc.outbox
            .push("target", "a", OutboxKind::Send, "one".into(), "one");
        svc.outbox
            .push("target", "b", OutboxKind::Send, "two".into(), "two");
        svc.try_flush("target").await;
        assert!(port.lock().sent.is_empty());
        port.update("target", |c| c.working = false);
        svc.on_event(&DaemonEvent::ChatUpdated {
            chat: crate::test_support::wire_chat("target"),
            reason: None,
        })
        .await;
        assert_eq!(
            port.lock().sent,
            vec![("target".to_string(), "one\n\ntwo".to_string())]
        );
        assert!(!svc.outbox.has_for("target"));
    }

    #[tokio::test]
    async fn holding_and_flushing_reannounce_the_target() {
        let port = FakePort::new();
        port.add_chat("target");
        port.add_chat("caller");
        let (svc, _ctx) = service_with(port.clone(), "caller");
        svc.outbox
            .push("target", "a", OutboxKind::Send, "one".into(), "one");
        assert_eq!(port.lock().changed, vec!["target"]);
        svc.try_flush("target").await;
        assert_eq!(port.lock().changed, vec!["target", "target"]);
        assert_eq!(port.lock().sent.len(), 1);
    }

    #[tokio::test]
    async fn a_cancelled_entry_is_never_sent() {
        let port = FakePort::new();
        port.add_chat("caller");
        let (svc, _ctx) = service_with(port.clone(), "caller");
        let id = svc
            .outbox
            .push("caller", "x", OutboxKind::Send, "hi".into(), "hi");
        let held = svc.agent_outbox("caller");
        assert_eq!(held.len(), 1);
        assert_eq!(
            (held[0].from_chat_id.as_str(), held[0].preview.as_str()),
            ("x", "hi")
        );
        assert!(svc.cancel_outbox_entry("caller", &id).await);
        assert!(!svc.cancel_outbox_entry("caller", &id).await);
        svc.try_flush("caller").await;
        assert!(port.lock().sent.is_empty());
    }

    #[tokio::test]
    async fn process_exit_revokes_the_matching_credential() {
        let port = FakePort::new();
        port.add_chat("caller");
        let (svc, ctx) = service_with(port, "caller");
        svc.on_event(&DaemonEvent::ProcessStopped {
            process_id: "session-caller".into(),
        })
        .await;
        assert!(!svc.credentials().has_credential("caller"));
        assert!(ctx.cancel.is_cancelled());
    }
}
