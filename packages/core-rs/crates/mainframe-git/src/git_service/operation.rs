//! Merge and rebase: running them, classifying conflicts, and aborting one in
//! progress.

use std::path::Path;

use mainframe_types::git::{ActiveOperation, MergeResult, MergeSummary, RebaseResult};

use super::{AbortResult, END_OF_OPTIONS, GitExec, GitService, GitServiceError};
use crate::git_exec::GitExecError;
use crate::git_parse::{count_auto_merges, parse_diff_stat_summary};
use crate::project_lock::acquire_project_lock;

impl<E: GitExec> GitService<E> {
    /// The merge or rebase in progress, if any.
    pub(super) async fn active_operation(&self) -> Option<ActiveOperation> {
        match self.git_dir().await {
            Ok(git_dir) => operation_in(&git_dir).await,
            Err(err) => {
                tracing::debug!(error = %err, "git dir lookup failed");
                None
            }
        }
    }

    /// Paths left unmerged by a failed merge, pull, or rebase; empty when the
    /// failure was not a conflict.
    pub(super) async fn unmerged_paths(&self) -> Result<Vec<String>, GitExecError> {
        Ok(self
            .git(argv!["diff", "--name-only", "--diff-filter=U"])
            .await?
            .lines()
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect())
    }

    pub async fn merge(&self, branch: &str) -> Result<MergeResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        match self
            .git_unbounded(argv!["merge", END_OF_OPTIONS, branch])
            .await
        {
            Ok(output) => {
                let summary = parse_diff_stat_summary(&output);
                Ok(MergeResult::Success {
                    summary: MergeSummary {
                        // Wire contract: clients read the auto-merged file count as `commits`.
                        commits: i64::try_from(count_auto_merges(&output)).unwrap_or(i64::MAX),
                        insertions: summary.insertions,
                        deletions: summary.deletions,
                    },
                })
            }
            Err(err) => {
                let conflicts = self.unmerged_paths().await?;
                if conflicts.is_empty() {
                    return Err(err.into());
                }
                Ok(MergeResult::Conflict {
                    conflicts,
                    message: err.to_string(),
                })
            }
        }
    }

    pub async fn rebase(&self, branch: &str) -> Result<RebaseResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        let Err(err) = self
            .git_unbounded(argv!["rebase", END_OF_OPTIONS, branch])
            .await
        else {
            return Ok(RebaseResult::Success);
        };
        // A rebase stopped on a conflict leaves its state directory behind.
        // When that cannot be confirmed, report the rebase's own failure.
        let stopped = match self.git_dir().await {
            Ok(git_dir) => operation_in(&git_dir).await == Some(ActiveOperation::Rebase),
            Err(_) => false,
        };
        if !stopped {
            return Err(err.into());
        }
        match self.unmerged_paths().await {
            Ok(conflicts) => Ok(RebaseResult::Conflict {
                conflicts,
                message: err.to_string(),
            }),
            Err(_) => Err(err.into()),
        }
    }

    /// Aborts the merge or rebase in progress. `aborted` is false when there
    /// was none, or when git refused to abort it.
    pub async fn abort(&self) -> Result<AbortResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        let git_dir = self.git_dir().await?;
        let args = match operation_in(&git_dir).await {
            Some(ActiveOperation::Merge) => argv!["merge", "--abort"],
            Some(ActiveOperation::Rebase) => argv!["rebase", "--abort"],
            None => return Ok(AbortResult { aborted: false }),
        };
        let aborted = match self.git(args).await {
            Ok(_) => true,
            Err(err) => {
                tracing::warn!(error = %err, "git abort failed");
                false
            }
        };
        Ok(AbortResult { aborted })
    }
}

/// Reads the merge or rebase state git keeps under `git_dir`.
async fn operation_in(git_dir: &Path) -> Option<ActiveOperation> {
    if exists(&git_dir.join("MERGE_HEAD")).await {
        return Some(ActiveOperation::Merge);
    }
    for state_dir in ["rebase-merge", "rebase-apply"] {
        if exists(&git_dir.join(state_dir)).await {
            return Some(ActiveOperation::Rebase);
        }
    }
    None
}

async fn exists(path: &Path) -> bool {
    tokio::fs::try_exists(path).await.unwrap_or(false)
}

#[cfg(test)]
#[path = "operation_tests.rs"]
mod tests;
