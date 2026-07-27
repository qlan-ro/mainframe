//! Ported from `packages/types/src/worktree-offer.ts`.

use serde::{Deserialize, Serialize};

/// A worktree the daemon noticed an agent register mid-session, offered to the
/// chat as a switch target. `worktree_path` is canonical and is the offer's
/// identity — dismissals, accepts and expiries are all keyed by it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSwitchOffer {
    pub chat_id: String,
    pub worktree_path: String,
    /// Short name (`refs/heads/` stripped); `None` for a detached worktree.
    pub branch_name: Option<String>,
    /// Epoch ms; orders the multi-offer list.
    pub detected_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorktreeOfferOutcome {
    Accepted,
    Dismissed,
    Expired,
}
