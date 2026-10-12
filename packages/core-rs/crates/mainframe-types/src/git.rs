use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub current: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracking: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behind: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActiveOperation {
    Merge,
    Rebase,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchListResult {
    pub current: String,
    pub local: Vec<BranchInfo>,
    pub remote: Vec<String>,
    pub worktrees: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_operation: Option<ActiveOperation>,
}

/// Addition/deletion counts for a single working-tree file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkingStatFile {
    pub path: String,
    pub additions: i64,
    pub deletions: i64,
}

/// Per-file working-tree stat counts plus repo-wide totals.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingStat {
    pub files: Vec<WorkingStatFile>,
    pub total_additions: i64,
    pub total_deletions: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum FetchResult {
    #[serde(rename = "success")]
    Success { remote: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PullSummary {
    pub changes: i64,
    pub insertions: i64,
    pub deletions: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum PullResult {
    #[serde(rename = "success")]
    Success { summary: PullSummary },
    #[serde(rename = "up-to-date")]
    UpToDate,
    #[serde(rename = "conflict")]
    Conflict {
        conflicts: Vec<String>,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MergeSummary {
    pub commits: i64,
    pub insertions: i64,
    pub deletions: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum MergeResult {
    #[serde(rename = "success")]
    Success { summary: MergeSummary },
    #[serde(rename = "conflict")]
    Conflict {
        conflicts: Vec<String>,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum RebaseResult {
    #[serde(rename = "success")]
    Success,
    #[serde(rename = "conflict")]
    Conflict {
        conflicts: Vec<String>,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum PushResult {
    #[serde(rename = "success")]
    Success { branch: String, remote: String },
    #[serde(rename = "rejected")]
    Rejected { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum DeleteBranchResult {
    #[serde(rename = "success")]
    Success,
    #[serde(rename = "not-merged")]
    NotMerged { message: String },
    #[serde(rename = "is-current")]
    IsCurrent { message: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BranchUpdateStatusKind {
    Updated,
    UpToDate,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BranchUpdateStatus {
    pub branch: String,
    pub status: BranchUpdateStatusKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateAllResult {
    pub fetched: bool,
    pub pull: PullResult,
    pub branches: Vec<BranchUpdateStatus>,
}

#[cfg(test)]
#[path = "git_tests.rs"]
mod tests;
