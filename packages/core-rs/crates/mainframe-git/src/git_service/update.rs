//! "Update all": fetch every remote, pull the current branch, and
//! fast-forward every other tracking branch.

use mainframe_types::git::{
    BranchUpdateStatus, BranchUpdateStatusKind, PullResult, UpdateAllResult,
};

use super::sync::pull_result;
use super::{GitExec, GitService, GitServiceError};
use crate::project_lock::acquire_project_lock;

impl<E: GitExec> GitService<E> {
    pub async fn update_all(&self) -> Result<UpdateAllResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        let fetched = match self.git_unbounded(argv!["fetch", "--all", "--prune"]).await {
            Ok(_) => true,
            Err(err) => {
                tracing::warn!(error = %err, "git fetch failed during update-all");
                false
            }
        };
        Ok(UpdateAllResult {
            fetched,
            pull: self.pull_current_for_update().await?,
            branches: self.fast_forward_tracking_branches().await,
        })
    }

    async fn pull_current_for_update(&self) -> Result<PullResult, GitServiceError> {
        let err = match self.git_unbounded(argv!["pull", "--ff-only"]).await {
            Ok(out) => return Ok(pull_result(&out)),
            Err(err) => err,
        };
        let conflicts = self.unmerged_paths().await?;
        if conflicts.is_empty() {
            // `UpdateAllResult` has no pull-failure variant; the warning is the
            // only record of it.
            tracing::warn!(error = %err, "git pull failed during update-all");
            return Ok(PullResult::UpToDate);
        }
        Ok(PullResult::Conflict {
            conflicts,
            message: err.to_string(),
        })
    }

    /// Fast-forwards every non-current local branch that tracks a remote branch.
    async fn fast_forward_tracking_branches(&self) -> Vec<BranchUpdateStatus> {
        let current = match self.branch_info(false).await {
            Ok(info) => info.current,
            Err(err) => {
                tracing::warn!(error = %err, "current branch lookup failed during update-all");
                return Vec::new();
            }
        };
        let tracking = match self.tracking_branches().await {
            Ok(tracking) => tracking,
            Err(err) => {
                tracing::warn!(error = %err, "branch enumeration failed during update-all");
                return Vec::new();
            }
        };

        let mut statuses = Vec::new();
        for t in tracking {
            if t.branch == current || t.tracks_local_branch() {
                continue;
            }
            let (status, error) = match self
                .fast_forward(&t.branch, &t.remote, &t.remote_branch)
                .await
            {
                Ok(true) => (BranchUpdateStatusKind::Updated, None),
                Ok(false) => (BranchUpdateStatusKind::UpToDate, None),
                Err(err) => (BranchUpdateStatusKind::Error, Some(err.to_string())),
            };
            statuses.push(BranchUpdateStatus {
                branch: t.branch,
                status,
                error,
            });
        }
        statuses
    }
}

#[cfg(test)]
#[path = "update_tests.rs"]
mod tests;
