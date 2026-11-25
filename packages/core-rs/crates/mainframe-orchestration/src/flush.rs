//! Sending what the outbox holds for a chat, once that chat is idle.

use mainframe_types::orchestration::TaskDelivery;

use crate::errors::PortError;
use crate::outbox::{OutboxEntry, OutboxKind, batch_body};
use crate::policy::check_ceiling;
use crate::ports::ChatView;
use crate::service::OrchestrationService;
use crate::state::{AgentMessageKind, ChatState, derive_state, wrap_agent_message};
use crate::turn_flags::Hold;

/// What one chat's flush leaves to do.
#[derive(Default)]
struct Flush {
    dropped_senders: Vec<String>,
    failed: bool,
}

/// A chat's held messages, by what may happen to them now.
#[derive(Default)]
struct Sorted {
    deliverable: Vec<OutboxEntry>,
    /// The sender could not be read, so neither delivered nor dropped.
    unverified: Vec<OutboxEntry>,
    dropped_senders: Vec<String>,
}

impl OrchestrationService {
    /// Sends everything held for `chat_id` as one message once it is idle,
    /// then flushes every chat that told something on the way: a sender whose
    /// message was dropped, or the parent of a task that ended undelivered.
    /// Either may be idle, with no other event coming to flush it on.
    pub(crate) async fn try_flush(&self, chat_id: &str) {
        let mut pending = vec![chat_id.to_string()];
        while let Some(target) = pending.pop() {
            if !self.outbox.has_for(&target) {
                continue;
            }
            let flush = self.flush_one(&target).await;
            pending.extend(flush.dropped_senders);
            if flush.failed {
                match self.fail_undeliverable(&target).await {
                    Ok(parent) => pending.extend(parent),
                    Err(err) => {
                        tracing::warn!(chat_id = target, error = %err, "failed to end a task whose delivery failed");
                    }
                }
            }
        }
    }

    /// One target's flush. `flush_lock` is not reentrant, so whatever it calls
    /// for next is left to the caller.
    async fn flush_one(&self, chat_id: &str) -> Flush {
        let _guard = self.flush_lock.lock().await;
        if self.is_held(chat_id) {
            return Flush::default();
        }
        let chat = match self.port.chat(chat_id).await {
            Ok(chat) => chat,
            Err(err) => {
                tracing::warn!(chat_id, error = %err, "failed to read a chat with held messages");
                return Flush::default();
            }
        };
        // Its held messages do not make a chat busy, so the outbox is ignored.
        let state = chat.as_ref().map(|chat| derive_state(chat, false));
        match (chat, state) {
            (Some(chat), Some(ChatState::Idle)) => self.deliver(&chat).await,
            (None, _) | (_, Some(ChatState::Ended | ChatState::Archived)) => {
                self.drop_held_messages(chat_id).await;
                Flush::default()
            }
            _ => Flush::default(),
        }
    }

    async fn deliver(&self, target: &ChatView) -> Flush {
        self.set_delivering(Some(&target.id));
        let Sorted {
            deliverable,
            unverified,
            dropped_senders,
        } = self.recheck_ceiling(target).await;
        if !unverified.is_empty() {
            self.keep(target, unverified);
        }
        let failed = match self.send_batch(target, &deliverable).await {
            Ok(()) => {
                self.set_delivering(None);
                self.set_delivery(&deliverable, TaskDelivery::Delivered)
                    .await;
                false
            }
            Err(err) => {
                tracing::warn!(chat_id = target.id, error = %err, "outbox delivery failed; keeping entries");
                self.keep(target, deliverable);
                self.set_delivering(None);
                true
            }
        };
        Flush {
            dropped_senders,
            failed,
        }
    }

    async fn send_batch(
        &self,
        target: &ChatView,
        entries: &[OutboxEntry],
    ) -> Result<(), PortError> {
        if entries.is_empty() {
            return Ok(());
        }
        self.port.send(&target.id, &batch_body(entries)).await
    }

    /// Puts taken entries back for the target's next turn. Held first: putting
    /// them back announces the chat, and that event would retry right away,
    /// for as long as the delivery keeps failing.
    fn keep(&self, target: &ChatView, entries: Vec<OutboxEntry>) {
        self.hold(&target.id, Hold::DeliveryFailed);
        self.outbox.restore(entries);
    }

    /// Takes everything held for `target` and re-checks each queued `chat_send`
    /// against the ceiling, last checked when it was sent: either chat's mode
    /// may have changed since. Task results and notices always pass: neither
    /// drives the target.
    async fn recheck_ceiling(&self, target: &ChatView) -> Sorted {
        let mut sorted = Sorted::default();
        for entry in self.outbox.take_for(&target.id) {
            let passes = match entry.kind {
                OutboxKind::Send => {
                    self.sender_still_passes_ceiling(&entry.from_chat_id, target)
                        .await
                }
                OutboxKind::TaskResult { .. } | OutboxKind::Notice => Ok(true),
            };
            match passes {
                Ok(true) => sorted.deliverable.push(entry),
                Ok(false) => {
                    tracing::warn!(
                        chat_id = target.id,
                        from_chat_id = entry.from_chat_id,
                        entry_id = entry.entry_id,
                        "queued chat_send dropped: sender no longer passes the ceiling at delivery time"
                    );
                    self.notify_send_dropped(&target.id, &entry);
                    sorted.dropped_senders.push(entry.from_chat_id);
                }
                Err(err) => {
                    tracing::warn!(
                        chat_id = target.id,
                        from_chat_id = entry.from_chat_id,
                        error = %err,
                        "failed to read a held message's sender; keeping the message"
                    );
                    sorted.unverified.push(entry);
                }
            }
        }
        sorted
    }

    /// Drops everything held for `chat_id` and records it on the task results
    /// among them: one left owed would be queued again by the next daemon.
    pub(crate) async fn drop_held_messages(&self, chat_id: &str) -> usize {
        let dropped = self.outbox.take_for(chat_id);
        self.set_delivery(&dropped, TaskDelivery::Dropped).await;
        dropped.len()
    }

    /// Whether `sender_id` may still reach `target` under the ceiling, read
    /// fresh at delivery time. A sender that is gone cannot be verified, so
    /// it reads as refused rather than assumed safe.
    async fn sender_still_passes_ceiling(
        &self,
        sender_id: &str,
        target: &ChatView,
    ) -> Result<bool, PortError> {
        let sender = self.port.chat(sender_id).await?;
        Ok(sender.is_some_and(|s| check_ceiling(&s.privileges(), &target.privileges()).is_ok()))
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
}
