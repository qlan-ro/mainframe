//! Parsers for git's porcelain output. They take the raw text a command printed
//! and never run git themselves.

use serde::{Deserialize, Serialize};

use crate::git_exec::GitExecError;

mod branch;
mod remote;
mod status;
mod summary;
mod worktree;

pub use branch::{BranchList, parse_branch_list};
pub(crate) use branch::{BranchTracking, TRACKING_FORMAT, parse_branch_tracking};
pub use remote::{
    GitHubRepoRef, RemoteUrl, github_repo_from_url, is_valid_repo_segment, parse_remote_urls,
    parse_remotes,
};
pub(crate) use status::porcelain_z_entries;
pub use status::{StatusBuckets, parse_status_buckets, parse_status_lines};
pub(crate) use summary::parse_numstat_z;
pub use summary::{DiffStatSummary, count_auto_merges, parse_commit_hash, parse_diff_stat_summary};
pub use worktree::{WorktreeEntry, parse_worktree_list};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffEntry {
    pub status: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
}

/// Whether git failed because `cwd` is not inside a repository. Callers use it
/// to skip warnings for that expected case.
pub fn is_not_git_repo(err: &GitExecError) -> bool {
    err.stderr().contains("not a git repository")
}

/// Parses `git diff --name-status` output (tab-separated) into structured
/// entries. Renamed (R) and copied (C) entries carry an `old_path`.
pub fn parse_diff_name_status(output: &str) -> Vec<DiffEntry> {
    output
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut parts = line.split('\t');
            let status = parts.next().unwrap_or("");
            if status.starts_with(['R', 'C']) {
                let old_path = parts.next().map(String::from);
                DiffEntry {
                    status: status[..1].to_string(),
                    path: parts.next().unwrap_or("").to_string(),
                    old_path,
                }
            } else {
                DiffEntry {
                    status: status.to_string(),
                    path: parts.next().unwrap_or("").to_string(),
                    old_path: None,
                }
            }
        })
        .filter(|f| !f.path.is_empty())
        .collect()
}

#[cfg(test)]
#[path = "git_parse_tests.rs"]
mod tests;
