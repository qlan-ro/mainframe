//! Pending worktree switch offers, per chat.
//!
//! A chat records the worktrees registered when it activated (its baseline).
//! Triggers from the session sink coalesce into a rescan of `git worktree list`;
//! anything registered since the baseline that clears the eligibility gates
//! becomes a pending offer broadcast to that chat's subscribers. Each scan
//! re-baselines to the listing it saw, so the comparison is against the previous
//! worktree command rather than against chat activation.
//!
//! Detection is main-thread-only: Claude diverts subagent tool blocks to
//! `on_subagent_child` before the sink ever sees them, so a `git worktree add`
//! run inside a subagent stays invisible until the next top-level tool call
//! triggers a rescan. Offers are keyed by path, so nothing is lost but latency.
//!
//! This module owns the sync offer state machine; `rescan` owns the async half
//! that fills it.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};

use mainframe_adapter_api::BoxFuture;
use mainframe_services::workspace::{WorktreeEntry, get_worktrees};
use mainframe_types::events::DaemonEvent;
use mainframe_types::worktree_offer::{WorktreeOfferOutcome, WorktreeSwitchOffer};

mod rescan;

pub type NowFn = Arc<dyn Fn() -> i64 + Send + Sync>;

/// Errors surfaced by the offer routes; the messages cross the wire verbatim.
#[derive(Debug, thiserror::Error)]
pub enum OfferError {
    #[error("No pending worktree offer for that path")]
    NotPending,
    #[error("A worktree switch is already in progress")]
    SwitchInProgress,
    #[error("Worktree no longer exists")]
    Vanished,
    #[error("{0}")]
    Message(String),
}

impl OfferError {
    pub fn status_code(&self) -> u16 {
        match self {
            OfferError::SwitchInProgress => 409,
            _ => 400,
        }
    }
}

/// The narrow surface the registry needs. `list_worktrees` defaults to the real
/// git call, so only tests carry an override.
pub trait WorktreeOfferDeps: Send + Sync {
    fn emit_event(&self, event: DaemonEvent);
    fn projects_get_path(&self, project_id: &str) -> Option<String>;
    /// `(project_id, worktree_path)` for the chat.
    fn chat_binding(&self, chat_id: &str) -> Option<(String, Option<String>)>;
    /// Every *other* chat's worktree path in this project.
    fn other_chat_worktrees(&self, project_id: &str, chat_id: &str) -> HashSet<String>;
    fn get_dismissed_worktrees(&self, chat_id: &str) -> Vec<String>;
    fn add_dismissed_worktree(&self, chat_id: &str, worktree_path: &str) -> bool;

    fn list_worktrees<'a>(&'a self, project_path: &'a str) -> BoxFuture<'a, Vec<WorktreeEntry>> {
        Box::pin(async move { get_worktrees(project_path).await })
    }
}

#[derive(Default)]
struct ChatOffers {
    /// `None` until the chat's first scan, which seeds it defensively.
    baseline: Option<HashSet<String>>,
    pending: BTreeMap<String, WorktreeSwitchOffer>,
    rescanning: bool,
    rescan_queued: bool,
    /// Target path of the in-flight switch — the only switch guard there is.
    switching: Option<String>,
}

pub struct WorktreeOfferRegistry {
    deps: Arc<dyn WorktreeOfferDeps>,
    now: NowFn,
    state: Mutex<HashMap<String, ChatOffers>>,
}

impl WorktreeOfferRegistry {
    pub fn new(deps: Arc<dyn WorktreeOfferDeps>) -> Self {
        Self::with_clock(deps, Arc::new(|| chrono::Utc::now().timestamp_millis()))
    }

    pub fn with_clock(deps: Arc<dyn WorktreeOfferDeps>, now: NowFn) -> Self {
        Self {
            deps,
            now,
            state: Mutex::new(HashMap::new()),
        }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, ChatOffers>> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn snapshot(&self, chat_id: &str) -> Vec<WorktreeSwitchOffer> {
        let state = self.lock();
        let Some(chat) = state.get(chat_id) else {
            return Vec::new();
        };
        let mut offers: Vec<WorktreeSwitchOffer> = chat.pending.values().cloned().collect();
        offers.sort_by_key(|offer| offer.detected_at);
        offers
    }

    /// Permanent: the path lands in the chat's dismissed column, so it survives
    /// a restart and never becomes an offer again.
    pub fn dismiss(&self, chat_id: &str, worktree_path: &str) -> Result<(), OfferError> {
        {
            let mut state = self.lock();
            let chat = state.get_mut(chat_id).ok_or(OfferError::NotPending)?;
            if !chat.pending.contains_key(worktree_path) {
                return Err(OfferError::NotPending);
            }
            // Dismissing mid-rebind would strand the accept and file the chat's
            // brand-new worktree in its own dismissed set.
            if chat.switching.as_deref() == Some(worktree_path) {
                return Err(OfferError::SwitchInProgress);
            }
            chat.pending.remove(worktree_path);
        }
        self.deps.add_dismissed_worktree(chat_id, worktree_path);
        self.deps.emit_event(resolved_event(
            chat_id,
            worktree_path,
            WorktreeOfferOutcome::Dismissed,
        ));
        Ok(())
    }

    /// Claims the one switch slot. The offer stays pending: a rebind that fails
    /// must leave the user something to retry.
    pub fn claim_accept(
        &self,
        chat_id: &str,
        worktree_path: &str,
    ) -> Result<WorktreeSwitchOffer, OfferError> {
        let mut state = self.lock();
        let chat = state.get_mut(chat_id).ok_or(OfferError::NotPending)?;
        let offer = chat
            .pending
            .get(worktree_path)
            .cloned()
            .ok_or(OfferError::NotPending)?;
        if chat.switching.is_some() {
            return Err(OfferError::SwitchInProgress);
        }
        chat.switching = Some(worktree_path.to_string());
        Ok(offer)
    }

    pub fn release_accept(&self, chat_id: &str) {
        let mut state = self.lock();
        if let Some(chat) = state.get_mut(chat_id) {
            chat.switching = None;
        }
    }

    pub fn expire(&self, chat_id: &str, worktree_path: &str) {
        self.resolve(chat_id, worktree_path, WorktreeOfferOutcome::Expired);
    }

    /// The single source of `resolved{accepted}` — a rebind counts as an accept
    /// however it was initiated, and a rebind nobody offered stays silent.
    pub fn on_binding_changed(&self, chat_id: &str, worktree_path: Option<&str>) {
        if let Some(worktree_path) = worktree_path {
            self.resolve(chat_id, worktree_path, WorktreeOfferOutcome::Accepted);
        }
    }

    fn resolve(&self, chat_id: &str, worktree_path: &str, outcome: WorktreeOfferOutcome) {
        let removed = {
            let mut state = self.lock();
            state
                .get_mut(chat_id)
                .is_some_and(|chat| chat.pending.remove(worktree_path).is_some())
        };
        if removed {
            self.deps
                .emit_event(resolved_event(chat_id, worktree_path, outcome));
        }
    }

    /// Drops the chat's state on delete or dispose so the map stays bounded.
    pub fn forget(&self, chat_id: &str) {
        self.lock().remove(chat_id);
    }
}

fn resolved_event(
    chat_id: &str,
    worktree_path: &str,
    outcome: WorktreeOfferOutcome,
) -> DaemonEvent {
    DaemonEvent::WorktreeOfferResolved {
        chat_id: chat_id.to_string(),
        worktree_path: worktree_path.to_string(),
        outcome,
    }
}

#[cfg(test)]
mod tests;
