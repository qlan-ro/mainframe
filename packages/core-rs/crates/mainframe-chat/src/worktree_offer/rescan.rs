//! The async half of the registry: listing worktrees, canonicalizing every path
//! that feeds the scan, and turning the scan's verdict into events.
//!
//! This is the only place paths are canonicalized (A10). Pending keys are
//! therefore canonical, and the sync entry points in the parent module can
//! compare the path a caller hands back verbatim.

use std::collections::{BTreeSet, HashSet};
use std::sync::Arc;

use mainframe_services::workspace::WorktreeEntry;
use mainframe_types::events::DaemonEvent;
use mainframe_types::worktree_offer::{WorktreeOfferOutcome, WorktreeSwitchOffer};

use crate::worktree_offer_scan::{ScanInputs, ScanOutcome, scan};

use super::{WorktreeOfferRegistry, resolved_event};

impl WorktreeOfferRegistry {
    /// Records what is registered right now and drops any pending offers, so a
    /// re-activated chat never re-offers a worktree the user already lived with.
    pub async fn seed_baseline(&self, chat_id: &str, project_path: &str) {
        let listing = self.canonical_listing(project_path).await;
        let mut state = self.lock();
        let chat = state.entry(chat_id.to_string()).or_default();
        chat.baseline = Some(listing.into_iter().map(|entry| entry.path).collect());
        chat.pending.clear();
    }

    /// Sync and cheap — the sink calls it on every confirmed worktree-ish tool
    /// result. A burst collapses into the running scan plus one trailing rescan.
    pub fn on_trigger(self: &Arc<Self>, chat_id: &str) {
        {
            let mut state = self.lock();
            let chat = state.entry(chat_id.to_string()).or_default();
            if chat.rescanning {
                chat.rescan_queued = true;
                return;
            }
            chat.rescanning = true;
        }
        let registry = Arc::clone(self);
        let chat_id = chat_id.to_string();
        tokio::spawn(async move { registry.rescan(chat_id).await });
    }

    pub(super) async fn rescan(self: Arc<Self>, chat_id: String) {
        loop {
            self.rescan_once(&chat_id).await;
            let mut state = self.lock();
            let Some(chat) = state.get_mut(&chat_id) else {
                return;
            };
            if !chat.rescan_queued {
                chat.rescanning = false;
                return;
            }
            chat.rescan_queued = false;
        }
    }

    async fn rescan_once(&self, chat_id: &str) {
        let Some((project_id, chat_worktree)) = self.deps.chat_binding(chat_id) else {
            return;
        };
        let Some(project_path) = self.deps.projects_get_path(&project_id) else {
            return;
        };
        let listing = self.canonical_listing(&project_path).await;
        let main_worktree_path = canon(&project_path).await;
        let chat_worktree_path = match chat_worktree {
            Some(path) => Some(canon(&path).await),
            None => None,
        };
        let other_chat_worktrees = self.canonical_others(&project_id, chat_id).await;
        let dismissed: HashSet<String> = self
            .deps
            .get_dismissed_worktrees(chat_id)
            .into_iter()
            .collect();

        let Some((baseline, pending)) = self.baseline_and_pending(chat_id, &listing) else {
            return;
        };
        let outcome = scan(ScanInputs {
            main_worktree_path: &main_worktree_path,
            baseline: &baseline,
            current: &listing,
            chat_worktree_path: chat_worktree_path.as_deref(),
            dismissed: &dismissed,
            other_chat_worktrees: &other_chat_worktrees,
            pending: &pending,
        });

        for event in self.apply(chat_id, outcome, &listing) {
            self.deps.emit_event(event);
        }
    }

    /// `None` when the chat had no baseline yet — this scan seeds it instead of
    /// scanning, so a chat that predates the registry is not flooded with offers
    /// for worktrees that were already there.
    fn baseline_and_pending(
        &self,
        chat_id: &str,
        listing: &[WorktreeEntry],
    ) -> Option<(HashSet<String>, BTreeSet<String>)> {
        let mut state = self.lock();
        let chat = state.entry(chat_id.to_string()).or_default();
        match &chat.baseline {
            Some(baseline) => Some((baseline.clone(), chat.pending.keys().cloned().collect())),
            None => {
                chat.baseline = Some(listing.iter().map(|entry| entry.path.clone()).collect());
                None
            }
        }
    }

    /// Applies the scan to the pending set and hands back the events to emit;
    /// the caller emits once the state lock is gone. Also re-baselines to the
    /// listing this scan saw.
    fn apply(
        &self,
        chat_id: &str,
        outcome: ScanOutcome,
        listing: &[WorktreeEntry],
    ) -> Vec<DaemonEvent> {
        let detected_at = (self.now)();
        let mut events = Vec::new();
        let mut state = self.lock();
        let Some(chat) = state.get_mut(chat_id) else {
            return events;
        };
        for (worktree_path, branch_name) in outcome.raise {
            let offer = WorktreeSwitchOffer {
                chat_id: chat_id.to_string(),
                worktree_path: worktree_path.clone(),
                branch_name,
                detected_at,
            };
            chat.pending.insert(worktree_path, offer.clone());
            events.push(DaemonEvent::WorktreeOfferRaised {
                chat_id: chat_id.to_string(),
                offer,
            });
        }
        for worktree_path in outcome.expire {
            if chat.pending.remove(&worktree_path).is_some() {
                events.push(resolved_event(
                    chat_id,
                    &worktree_path,
                    WorktreeOfferOutcome::Expired,
                ));
            }
        }
        // "New" means new since the last worktree command, not since the chat
        // activated: a path that is removed and recreated is a different
        // worktree and deserves its own offer. Skipped on an empty listing —
        // that means the git call failed, and re-baselining to nothing would
        // make every worktree look new on the next scan.
        if !listing.is_empty() {
            chat.baseline = Some(listing.iter().map(|entry| entry.path.clone()).collect());
        }
        events
    }

    async fn canonical_listing(&self, project_path: &str) -> Vec<WorktreeEntry> {
        let entries = self.deps.list_worktrees(project_path).await;
        let mut canonical = Vec::with_capacity(entries.len());
        for entry in entries {
            canonical.push(WorktreeEntry {
                path: canon(&entry.path).await,
                branch: entry.branch,
            });
        }
        canonical
    }

    async fn canonical_others(&self, project_id: &str, chat_id: &str) -> HashSet<String> {
        let raw = self.deps.other_chat_worktrees(project_id, chat_id);
        let mut canonical = HashSet::with_capacity(raw.len());
        for path in raw {
            canonical.insert(canon(&path).await);
        }
        canonical
    }
}

/// Falls back to the input when the path does not resolve: a worktree deleted
/// mid-scan still needs a stable key to expire under.
async fn canon(path: &str) -> String {
    tokio::fs::canonicalize(path)
        .await
        .map(|resolved| resolved.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_string())
}
