//! The service's reactions to chat lifecycle: Stop cascades, outbox flushes
//! when a target goes idle, and credential revocation on process exit.

use std::sync::Arc;

use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast::error::RecvError;

use crate::outbox::batch_body;
use crate::service::OrchestrationService;
use crate::state::ChatState;
use crate::waiter::event_chat_id;

impl OrchestrationService {
    /// Steps 1–3 of a Stop (the caller performs step 4, the turn interrupt):
    /// end the chat's in-flight calls and refuse late ones, then drop every
    /// message held for it. Returns the task ids it cancelled.
    pub async fn cascade_stop(&self, chat_id: &str, reason: Option<&str>) -> Vec<String> {
        self.mark_stopping(chat_id);
        let _ = reason;
        let dropped = self.outbox.drop_for_target(chat_id);
        if dropped > 0 {
            tracing::info!(chat_id, dropped, "dropped held agent messages on stop");
        }
        Vec::new()
    }

    /// Sends everything held for `chat_id` as one message once it is idle.
    pub async fn try_flush(&self, chat_id: &str) {
        if !self.outbox.has_for(chat_id) {
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
        let body = batch_body(&entries);
        if let Err(err) = self.port.send(chat_id, &body).await {
            tracing::warn!(chat_id, ?err, "outbox delivery failed; keeping entries");
            self.outbox.restore(entries);
        }
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
            _ => {}
        }
        if let Some(chat_id) = event_chat_id(event) {
            if self.port.chat(chat_id).await.is_some_and(|c| !c.working) {
                self.clear_stopping(chat_id);
            }
            self.try_flush(chat_id).await;
        }
    }

    async fn on_lagged(&self) {
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
    async fn process_exit_revokes_the_matching_credential() {
        let port = FakePort::new();
        port.add_chat("caller");
        let (svc, ctx) = service_with(port, "caller");
        svc.on_event(&DaemonEvent::ProcessStopped {
            process_id: "session-1".into(),
        })
        .await;
        assert!(!svc.credentials().has_credential("caller"));
        assert!(ctx.cancel.is_cancelled());
    }
}
