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
