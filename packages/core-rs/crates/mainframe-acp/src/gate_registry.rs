//! Multi-client + cross-surface gate resolution (todo #350, plan task 17): a
//! gate raised on one chat is broadcast to every attached facade session, but
//! only the first answer is applied — a second facade client's answer, or a
//! legacy-surface answer arriving after a facade client already claimed it,
//! gets a structured "resolved" outcome instead of a second
//! `respond_to_permission` call.
//!
//! Cross-surface awareness rides the existing chat-surface seam
//! (`chat_surface::ChatSurfaceEvent::GateResolved`, mainframe-chat) — this
//! registry has no socket or `ChatManager` access; its caller is expected to
//! call [`GateRegistry::mark_resolved`] from that event and
//! [`GateRegistry::claim`] before ever calling `respond_to_permission`.

use std::collections::HashMap;

/// Per-chat cap on remembered resolved request ids — mirrors
/// `PermissionManager::CANCELLED_MEMORY`'s bounded-tombstone pattern so a
/// long-lived chat's registry can't grow unbounded.
const RESOLVED_MEMORY: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnswerOutcome {
    /// This caller is first: proceed to `respond_to_permission`.
    Apply,
    /// Someone else already resolved (or is resolving) this request — do not
    /// forward the answer; reply the client with the structured "resolved"
    /// outcome instead.
    AlreadyResolved,
}

#[derive(Default)]
pub struct GateRegistry {
    /// The request currently being applied per chat, so a second concurrent
    /// answer for the same request loses the race deterministically.
    claimed: HashMap<String, String>,
    /// Bounded FIFO of request ids resolved per chat (from any surface),
    /// oldest evicted first — a late answer against one of these is
    /// `AlreadyResolved` even after the claim above is cleared.
    resolved: HashMap<String, Vec<String>>,
}

impl GateRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// First-answer-wins: `Apply` exactly once per `(chat_id, request_id)`.
    pub fn claim(&mut self, chat_id: &str, request_id: &str) -> AnswerOutcome {
        if self.is_resolved(chat_id, request_id) {
            return AnswerOutcome::AlreadyResolved;
        }
        match self.claimed.get(chat_id) {
            Some(current) if current == request_id => AnswerOutcome::AlreadyResolved,
            _ => {
                self.claimed
                    .insert(chat_id.to_string(), request_id.to_string());
                AnswerOutcome::Apply
            }
        }
    }

    /// The request resolved — from this claim, from the legacy surface, or
    /// from the CLI cancelling it. Idempotent: marking an already-resolved
    /// id again is a no-op past the bounded memory.
    pub fn mark_resolved(&mut self, chat_id: &str, request_id: &str) {
        if self.claimed.get(chat_id).is_some_and(|id| id == request_id) {
            self.claimed.remove(chat_id);
        }
        let ring = self.resolved.entry(chat_id.to_string()).or_default();
        if !ring.iter().any(|id| id == request_id) {
            ring.push(request_id.to_string());
            while ring.len() > RESOLVED_MEMORY {
                ring.remove(0);
            }
        }
    }

    pub fn is_resolved(&self, chat_id: &str, request_id: &str) -> bool {
        self.resolved
            .get(chat_id)
            .is_some_and(|ring| ring.iter().any(|id| id == request_id))
    }

    /// Chat-level teardown (archive/end): drop all bookkeeping so it doesn't
    /// leak across a chat's later reuse of request ids.
    pub fn forget_chat(&mut self, chat_id: &str) {
        self.claimed.remove(chat_id);
        self.resolved.remove(chat_id);
    }
}

#[cfg(test)]
mod tests;
