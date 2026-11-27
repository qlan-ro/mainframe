use serde::{Deserialize, Serialize};

use super::ReplayBatchParams;
use crate::acp::update::SessionUpdate;

pub const WINDOWED_HISTORY_OPT_IN_KEY: &str = "windowedHistory";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryWindow {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub containers: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub floor_item_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_item_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryState {
    pub has_more: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub floor_item_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_item_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPageParams {
    pub session_id: String,
    pub before: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub containers: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until_item_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPageResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updates: Option<Vec<SessionUpdate>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub batches: Option<Vec<ReplayBatchParams>>,
    #[serde(flatten)]
    pub history: HistoryState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stale: Option<bool>,
}

/// `_mainframe.dev/history_around`: a page of items centred on one item,
/// independent of the connection's history floor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryAroundParams {
    pub session_id: String,
    pub item_id: String,
    /// Items before the target; defaults to 20, clamps to 0..=200.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<i64>,
    /// Items after the target; defaults to 20, clamps to 0..=200.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<i64>,
    /// Also return the target's descendants (a sub-agent's steps, the
    /// transitive `parentToolCallId` chain), up to a cap, whatever `after` says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_descendants: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryAroundResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updates: Option<Vec<SessionUpdate>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub batches: Option<Vec<ReplayBatchParams>>,
    /// Whether the transcript holds items before `firstItemId`.
    pub has_before: bool,
    /// Whether the transcript holds items after `lastItemId`.
    pub has_after: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_item_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_item_id: Option<String>,
    /// The item the request resolved to (a container id resolves to its first
    /// item, a tool-use id to its tool-call item).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_item_id: Option<String>,
    /// Ancestors of the first items (such as a sub-agent's parent tool call)
    /// sent only so the page renders; they precede `firstItemId`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_item_ids: Option<Vec<String>>,
    /// Set when `includeDescendants` was asked and the cap cut the descendants short.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_more_descendants: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stale: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySearchParams {
    pub session_id: String,
    pub query: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMatch {
    pub container_id: String,
    pub item_id: String,
    pub occurrence: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySearchResult {
    pub total: usize,
    pub matches: Vec<HistoryMatch>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentHistoryPageParams {
    pub session_id: String,
    pub agent_id: String,
    pub before: Option<String>,
    pub containers: Option<i64>,
    pub until_item_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentHistoryParams {
    pub session_id: String,
    pub agent_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubagentHistorySearchParams {
    #[serde(flatten)]
    pub target: SubagentHistoryParams,
    pub query: String,
}
