//! The service's reactions to chat lifecycle: task progress, outbox
//! flushes when a target goes idle, and credential revocation on exit.

use std::sync::Arc;

use mainframe_types::events::{ChatUpdatedReason, DaemonEvent};
use mainframe_types::orchestration::{AgentOutboxEntry, TaskDelivery};
use tokio::sync::broadcast::error::RecvError;

use crate::outbox::{OutboxEntry, OutboxKind, batch_body};
use crate::policy::check_ceiling;
use crate::ports::ChatView;
use crate::service::OrchestrationService;
use crate::state::{AgentMessageKind, ChatState, wrap_agent_message};
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
        // The ceiling was checked once, at `chat_send` time; the sender's or
        // the target's mode may have been raised or lowered since. A task
        // result is never subject to it (delivering a task's own outcome is
        // not "driving" the parent), only a queued `chat_send` is. A sender
        // that no longer passes is dropped: logged here, and reported back
        // to the sender as a `Notice` entry (there is no queued-send record
        // to mark failed — the outbox is in-memory only — so this is the
        // sender's only signal; it was told `delivery: "queued"` with an
        // `outboxEntryId` and would otherwise never learn the message died).
        let mut deliverable = Vec::with_capacity(entries.len());
        for entry in entries {
            if matches!(entry.kind, OutboxKind::Send)
                && !self
                    .sender_still_passes_ceiling(&entry.from_chat_id, &chat)
                    .await
            {
                tracing::warn!(
                    chat_id,
                    from_chat_id = entry.from_chat_id,
                    entry_id = entry.entry_id,
                    "queued chat_send dropped: sender no longer passes the ceiling at delivery time"
                );
                self.notify_send_dropped(chat_id, &entry);
                continue;
            }
            deliverable.push(entry);
        }
        if deliverable.is_empty() {
            return;
        }
        if let Err(err) = self.port.send(chat_id, &batch_body(&deliverable)).await {
            tracing::warn!(chat_id, ?err, "outbox delivery failed; keeping entries");
            self.outbox.restore(deliverable);
            return;
        }
        self.set_delivery(&deliverable, TaskDelivery::Delivered)
            .await;
    }

    /// Whether `sender_id` may still reach `target` under the ceiling, read
    /// fresh at delivery time. A sender that is gone cannot be verified, so
    /// it reads as refused rather than assumed safe.
    async fn sender_still_passes_ceiling(&self, sender_id: &str, target: &ChatView) -> bool {
        let Some(sender) = self.port.chat(sender_id).await else {
            return false;
        };
        check_ceiling(&sender.privileges(), &target.privileges()).is_ok()
    }

    /// Reports a dropped queued `Send` back to its sender, as a `Notice`
    /// entry: it rides the same outbox (delivered next time the sender goes
    /// idle), but is never itself subject to the ceiling re-check — it is
    /// infrastructure reporting on a `Send`, not one.
    fn notify_send_dropped(&self, target_chat_id: &str, entry: &OutboxEntry) {
        let note = format!(
            "Your queued message to {target_chat_id} was not delivered: \
             {target_chat_id}'s permission mode changed and no longer allows \
             this chat to reach it."
        );
        let body = wrap_agent_message(target_chat_id, AgentMessageKind::Dropped, &note);
        self.outbox.push(
            &entry.from_chat_id,
            target_chat_id,
            OutboxKind::Notice,
            body,
            &note,
        );
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
        // A chat that is now gone (discard deletes the row before emitting
        // `ChatEnded`, so `port.chat` reads `None`) can never run another
        // turn to go idle on, so its stopping flag must clear here too, or
        // it outlives the Stop and leaks for the rest of the process.
        if self.is_stopping(chat_id) && self.port.chat(chat_id).await.is_none_or(|c| !c.working) {
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
    use mainframe_types::settings::ExecutionMode;

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
        port.add_chat("a");
        port.add_chat("b");
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
        port.add_chat("a");
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

    /// The ceiling is checked once, at `chat_send` time; a queued entry's
    /// sender or target may have its mode raised or lowered before the
    /// target actually goes idle and the entry is flushed. A sender that no
    /// longer passes must not have its message delivered.
    #[tokio::test]
    async fn a_queued_send_that_no_longer_passes_the_ceiling_is_dropped_not_delivered() {
        let port = FakePort::new();
        let mut sender = port.add_chat("sender");
        sender.permission_mode = ExecutionMode::Default;
        port.put(sender);
        let mut target = port.add_chat("target");
        target.working = true;
        port.put(target);
        let (svc, _ctx) = service_with(port.clone(), "sender");
        svc.outbox
            .push("target", "sender", OutboxKind::Send, "hi".into(), "hi");

        // The target is raised above the sender's mode while the entry sits
        // queued, then goes idle.
        port.update("target", |c| {
            c.working = false;
            c.permission_mode = ExecutionMode::Yolo;
        });
        svc.try_flush("target").await;

        assert!(
            port.lock().sent.is_empty(),
            "the raised target must not receive it"
        );
        assert!(
            !svc.outbox.has_for("target"),
            "the dropped entry is not kept for a retry"
        );
        // The sender was told `delivery: "queued"` with an `outboxEntryId`
        // and has no other way to learn the message died: a `Notice` entry
        // now rides the same outbox back to it.
        let notice = svc
            .outbox
            .list_for("sender")
            .into_iter()
            .next()
            .expect("a dropped send is reported back to its sender");
        assert_eq!(notice.kind, OutboxKind::Notice);
        assert_eq!(notice.from_chat_id, "target");
        assert!(notice.body.contains("<mainframe-agent-message"));
        assert!(notice.body.contains("kind=\"dropped\""));

        // It delivers like any other outbox entry, once the sender is idle,
        // and is never itself subject to the ceiling re-check.
        svc.try_flush("sender").await;
        assert_eq!(
            port.lock().sent,
            vec![("sender".to_string(), notice.body.clone())]
        );
    }

    /// The companion case: nothing changed, so the queued send still
    /// delivers normally — the re-check must not be a no-op that always
    /// refuses.
    #[tokio::test]
    async fn a_queued_send_that_still_passes_the_ceiling_delivers_normally() {
        let port = FakePort::new();
        port.add_chat("sender");
        let mut target = port.add_chat("target");
        target.working = true;
        port.put(target);
        let (svc, _ctx) = service_with(port.clone(), "sender");
        svc.outbox
            .push("target", "sender", OutboxKind::Send, "hi".into(), "hi");

        port.update("target", |c| c.working = false);
        svc.try_flush("target").await;

        assert_eq!(
            port.lock().sent,
            vec![("target".to_string(), "hi".to_string())]
        );
    }

    /// Discard deletes the chat row before emitting `ChatEnded`
    /// (`chat_manager/discard.rs`), so `port.chat` reads `None` by the time
    /// the orchestration event loop sees it. The stopping flag must still
    /// clear, or it leaks for the rest of the process (the chat can never
    /// run another turn to go idle on).
    #[tokio::test]
    async fn a_discarded_chats_stopping_flag_clears_even_though_its_row_is_gone() {
        let port = FakePort::new();
        port.add_chat("caller");
        let (svc, _ctx) = service_with(port.clone(), "caller");
        svc.mark_stopping("gone");
        port.remove("gone");
        svc.on_event(&DaemonEvent::ChatEnded {
            chat_id: "gone".to_string(),
        })
        .await;
        assert!(!svc.is_stopping("gone"));
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
