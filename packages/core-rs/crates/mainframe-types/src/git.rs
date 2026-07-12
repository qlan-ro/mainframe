//! Ported from `packages/types/src/git.ts`.

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
mod tests {
    use super::*;

    #[test]
    fn branch_info_omits_optionals() {
        let json = r#"{"name":"main","current":true}"#;
        let b: BranchInfo = serde_json::from_str(json).unwrap();
        assert!(b.current);
        assert_eq!(serde_json::to_string(&b).unwrap(), json);
    }

    #[test]
    fn pull_result_success_tagged() {
        let json = r#"{"status":"success","summary":{"changes":3,"insertions":10,"deletions":2}}"#;
        let r: PullResult = serde_json::from_str(json).unwrap();
        matches!(r, PullResult::Success { .. });
        assert_eq!(serde_json::to_string(&r).unwrap(), json);
    }

    #[test]
    fn pull_result_up_to_date_unit_variant() {
        let json = r#"{"status":"up-to-date"}"#;
        let r: PullResult = serde_json::from_str(json).unwrap();
        assert!(matches!(r, PullResult::UpToDate));
        assert_eq!(serde_json::to_string(&r).unwrap(), json);
    }

    #[test]
    fn delete_branch_result_kebab_variants() {
        let json = r#"{"status":"not-merged","message":"branch not fully merged"}"#;
        let r: DeleteBranchResult = serde_json::from_str(json).unwrap();
        assert!(matches!(r, DeleteBranchResult::NotMerged { .. }));
        assert_eq!(serde_json::to_string(&r).unwrap(), json);
    }

    #[test]
    fn fetch_result_single_variant_round_trips() {
        let json = r#"{"status":"success","remote":"origin"}"#;
        let r: FetchResult = serde_json::from_str(json).unwrap();
        assert_eq!(serde_json::to_string(&r).unwrap(), json);
    }

    #[test]
    fn branch_update_status_kind_kebab() {
        assert_eq!(
            serde_json::to_string(&BranchUpdateStatusKind::UpToDate).unwrap(),
            "\"up-to-date\""
        );
    }

    #[test]
    fn working_stat_round_trips() {
        let json = r#"{"files":[{"path":"a.rs","additions":5,"deletions":1}],"totalAdditions":5,"totalDeletions":1}"#;
        let s: WorkingStat = serde_json::from_str(json).unwrap();
        assert_eq!(s.total_additions, 5);
        assert_eq!(serde_json::to_string(&s).unwrap(), json);
    }
}

// PORT STATUS: packages/types/src/git.ts (68 lines)
// confidence: high
// todos: 0
// notes: the result unions (Fetch/Pull/Merge/Rebase/Push/DeleteBranch) are
// internally-tagged enums on "status" with explicit renames for the kebab literals
// (up-to-date, not-merged, is-current). Inline `summary` objects become named
// structs (PullSummary, MergeSummary). All counts (ahead/behind/additions/
// insertions/etc.) are i64. BranchInfo optionals + BranchListResult.activeOperation
// + BranchUpdateStatus.error use Option + skip_serializing_if.
