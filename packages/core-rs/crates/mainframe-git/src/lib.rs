//! `mainframe-git` — the git subprocess primitive, porcelain parsers, the
//! `GitService` command surface, and the per-project async lock.
//!
//! Ported from `packages/core/src/git/*` and `src/server/routes/exec-git.ts`.

#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod exec_git;
pub mod git_exec;
pub mod git_parse;
pub mod git_service;
pub mod project_lock;

pub use git_exec::{GitExecCode, GitExecError, GitExecOptions, exec_git};
pub use git_parse::{
    BranchList, DiffEntry, DiffStatSummary, PorcelainStatus, StatusBuckets, StatusFile,
    count_auto_merges, is_not_git_repo, parse_branch_list, parse_commit_hash,
    parse_diff_name_status, parse_diff_stat_summary, parse_remotes, parse_status_buckets,
    parse_status_lines, parse_status_z,
};
pub use git_service::{
    AbortResult, DetectedBaseBranch, GitExec, GitService, GitServiceError, RealGitExec,
};
pub use project_lock::acquire_project_lock;

// PORT STATUS: crate root (re-exports; no TS index.ts counterpart in src/git/)
// confidence: high
// todos: 0
// notes: Modules — git_exec (git/git-exec.ts), git_parse (git/git-parse.ts),
// git_service (git/git-service.ts), project_lock (git/project-lock.ts), exec_git
// (server/routes/exec-git.ts, re-export of git_exec per single-canonical rule).
