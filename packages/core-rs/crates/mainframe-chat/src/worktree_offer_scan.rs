//! Pure eligibility scan turning a git worktree listing into offer candidates.
//!
//! Paths are compared verbatim — no IO, no locks, no clock. The registry
//! canonicalizes every path source before it builds `ScanInputs`, so a path that
//! reaches here has already been resolved (A10).

use std::collections::{BTreeSet, HashSet};

use mainframe_services::workspace::{WorktreeEntry, short_branch};

pub struct ScanInputs<'a> {
    /// The project's main checkout — registered, but never an offer.
    pub main_worktree_path: &'a str,
    /// Worktrees the previous scan saw (the chat's activation listing until then);
    /// anything here is old news.
    pub baseline: &'a HashSet<String>,
    /// `git worktree list` as it stands now; empty when the git call failed.
    pub current: &'a [WorktreeEntry],
    pub chat_worktree_path: Option<&'a str>,
    pub dismissed: &'a HashSet<String>,
    pub other_chat_worktrees: &'a HashSet<String>,
    pub pending: &'a BTreeSet<String>,
}

pub struct ScanOutcome {
    /// `(worktree path, short branch name)` per candidate, in listing order.
    pub raise: Vec<(String, Option<String>)>,
    /// Pending offers whose worktree is gone.
    pub expire: Vec<String>,
}

pub fn scan(inputs: ScanInputs<'_>) -> ScanOutcome {
    let raise = inputs
        .current
        .iter()
        .filter(|entry| is_eligible(&inputs, &entry.path))
        .map(|entry| {
            let branch = entry.branch.as_deref().map(|b| short_branch(b).to_string());
            (entry.path.clone(), branch)
        })
        .collect();

    let live: HashSet<&str> = inputs.current.iter().map(|e| e.path.as_str()).collect();
    let expire = inputs
        .pending
        .iter()
        .filter(|path| !live.contains(path.as_str()))
        .cloned()
        .collect();

    ScanOutcome { raise, expire }
}

/// The five gates a registered worktree clears before it is worth offering.
fn is_eligible(inputs: &ScanInputs<'_>, path: &str) -> bool {
    path != inputs.main_worktree_path
        && !inputs.baseline.contains(path)
        && inputs.chat_worktree_path != Some(path)
        && !inputs.dismissed.contains(path)
        && !inputs.other_chat_worktrees.contains(path)
        && !inputs.pending.contains(path)
}

#[cfg(test)]
#[path = "worktree_offer_scan_tests.rs"]
mod tests;
