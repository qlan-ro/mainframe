//! The async half of the registry: listing worktrees, canonicalizing every path
//! that feeds the scan, and turning the scan's verdict into events.
//!
//! This is the only place paths are canonicalized (A10). Pending keys are
//! therefore canonical, and the sync entry points in the parent module can
//! compare the path a caller hands back verbatim.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::time::UNIX_EPOCH;

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
        let seen = identities(&listing).await;
        let mut state = self.lock();
        let chat = state.entry(chat_id.to_string()).or_default();
        chat.baseline = Some(seen);
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

        let seen = identities(&listing).await;
        let Some((baseline, pending)) = self.baseline_and_pending(chat_id, &seen) else {
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

        for event in self.apply(chat_id, outcome, &seen) {
            self.deps.emit_event(event);
        }
    }

    /// `None` when the chat had no baseline yet — this scan seeds it instead of
    /// scanning, so a chat that predates the registry is not flooded with offers
    /// for worktrees that were already there.
    ///
    /// A remembered path drops out of the returned set when its identity no
    /// longer matches: that path holds a different worktree now, so it is not
    /// the one the chat already saw.
    fn baseline_and_pending(
        &self,
        chat_id: &str,
        seen: &Identities,
    ) -> Option<(HashSet<String>, BTreeSet<String>)> {
        let mut state = self.lock();
        let chat = state.entry(chat_id.to_string()).or_default();
        match &chat.baseline {
            Some(baseline) => {
                let unchanged = baseline
                    .iter()
                    .filter(|(path, id)| is_same_worktree(**id, seen.get(*path).copied().flatten()))
                    .map(|(path, _)| path.clone())
                    .collect();
                Some((unchanged, chat.pending.keys().cloned().collect()))
            }
            None => {
                chat.baseline = Some(seen.clone());
                None
            }
        }
    }

    /// Applies the scan to the pending set and hands back the events to emit;
    /// the caller emits once the state lock is gone. Also re-baselines to the
    /// listing this scan saw.
    fn apply(&self, chat_id: &str, outcome: ScanOutcome, seen: &Identities) -> Vec<DaemonEvent> {
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
        // Remember what this scan saw, so "already seen" tracks the last
        // worktree command rather than chat activation. Skipped on an empty
        // listing — that means the git call failed, and forgetting everything
        // would make every worktree look new on the next scan.
        if !seen.is_empty() {
            chat.baseline = Some(seen.clone());
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

/// What each registered path held when a scan last looked at it. `None` for a
/// path whose identity could not be read.
pub(super) type Identities = HashMap<String, Option<u128>>;

/// A linked worktree's `.git` is a one-line file git writes when the worktree is
/// created and never touches again, so its mtime dates the worktree itself.
/// Remove and recreate one at the same path and the mtime changes — which is how
/// a rebuilt worktree is told apart from the one already seen, even when the
/// path, branch, and commit all match. (The main checkout's `.git` is a
/// directory whose mtime churns, but it is never offered anyway.)
async fn identity(path: &str) -> Option<u128> {
    let meta = tokio::fs::symlink_metadata(Path::new(path).join(".git"))
        .await
        .ok()?;
    let modified = meta.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_nanos())
}

async fn identities(listing: &[WorktreeEntry]) -> Identities {
    let mut seen = HashMap::with_capacity(listing.len());
    for entry in listing {
        seen.insert(entry.path.clone(), identity(&entry.path).await);
    }
    seen
}

/// Unreadable on either side means "assume unchanged": guessing the other way
/// would re-offer a worktree the user has already lived with.
fn is_same_worktree(seen: Option<u128>, current: Option<u128>) -> bool {
    match (seen, current) {
        (Some(seen), Some(current)) => seen == current,
        _ => true,
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
