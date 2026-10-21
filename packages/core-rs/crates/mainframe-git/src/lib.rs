//! `mainframe-git` — the git subprocess primitive, porcelain parsers, the
//! `GitService` command surface, and the per-project async lock.

#![forbid(unsafe_code)]
#![cfg_attr(
    test,
    allow(
        clippy::too_many_lines,
        clippy::unwrap_used,
        clippy::expect_used,
        reason = "Test assertions and scenarios"
    )
)]

pub mod git_exec;
pub mod git_parse;
pub mod git_service;
pub mod project_lock;

pub use git_exec::{GitExecError, GitTimeout, exec_git};
pub use git_parse::{
    BranchList, DiffEntry, DiffStatSummary, GitHubRepoRef, RemoteUrl, StatusBuckets, WorktreeEntry,
    count_auto_merges, github_repo_from_url, is_not_git_repo, is_valid_repo_segment,
    parse_branch_list, parse_commit_hash, parse_diff_name_status, parse_diff_stat_summary,
    parse_remote_urls, parse_remotes, parse_status_buckets, parse_status_lines,
    parse_worktree_list,
};
pub use git_service::{
    AbortResult, DetectedBaseBranch, GitExec, GitService, GitServiceError, RealGitExec,
};
pub use project_lock::acquire_project_lock;
