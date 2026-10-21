//! Fetch, pull, and push.

use mainframe_types::git::{FetchResult, PullResult, PullSummary, PushResult};

use super::{END_OF_OPTIONS, GitExec, GitService, GitServiceError};
use crate::git_exec::GitExecError;
use crate::git_parse::parse_diff_stat_summary;
use crate::project_lock::acquire_project_lock;

impl<E: GitExec> GitService<E> {
    pub async fn fetch(&self, remote: Option<&str>) -> Result<FetchResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        let args = match remote {
            Some(r) => argv!["fetch", "--prune", END_OF_OPTIONS, r],
            None => argv!["fetch", "--all", "--prune"],
        };
        self.git_unbounded(args).await?;
        Ok(FetchResult::Success {
            remote: remote.unwrap_or("all").to_string(),
        })
    }

    /// Fast-forwards a branch from its remote. When `local_branch` names a
    /// branch other than the current one, it is updated in place without
    /// touching the working tree.
    pub async fn pull(
        &self,
        remote: Option<&str>,
        branch: Option<&str>,
        local_branch: Option<&str>,
    ) -> Result<PullResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        if let (Some(local), Some(branch)) = (local_branch, branch)
            && self.branch_info(false).await?.current != local
        {
            let moved = self
                .fast_forward(local, remote.unwrap_or("origin"), branch)
                .await?;
            return Ok(if moved {
                PullResult::Success {
                    summary: PullSummary {
                        changes: 0,
                        insertions: 0,
                        deletions: 0,
                    },
                }
            } else {
                PullResult::UpToDate
            });
        }

        let mut args = argv!["pull", "--ff-only", END_OF_OPTIONS];
        args.extend(remote.map(String::from));
        args.extend(branch.map(String::from));
        match self.git_unbounded(args).await {
            Ok(out) => Ok(pull_result(&out)),
            Err(err) => {
                let conflicts = self.unmerged_paths().await?;
                if conflicts.is_empty() {
                    return Err(err.into());
                }
                Ok(PullResult::Conflict {
                    conflicts,
                    message: err.to_string(),
                })
            }
        }
    }

    /// Updates `local` to `remote`'s `remote_branch` with
    /// `git fetch <remote> <remote_branch>:<local>`, which only fast-forwards.
    /// Returns whether the branch moved.
    pub(super) async fn fast_forward(
        &self,
        local: &str,
        remote: &str,
        remote_branch: &str,
    ) -> Result<bool, GitExecError> {
        let before = self.rev_parse(local).await?;
        self.git_unbounded(argv![
            "fetch",
            END_OF_OPTIONS,
            remote,
            format!("{remote_branch}:{local}")
        ])
        .await?;
        Ok(self.rev_parse(local).await? != before)
    }

    async fn rev_parse(&self, rev: &str) -> Result<String, GitExecError> {
        let out = self
            .git(argv!["rev-parse", "--verify", END_OF_OPTIONS, rev])
            .await?;
        Ok(out.trim().to_string())
    }

    /// Pushes `branch` (default: the current branch) to its upstream's branch
    /// name on `remote` (default: `origin`), or to the same name when it has
    /// no upstream.
    pub async fn push(
        &self,
        branch: Option<&str>,
        remote: Option<&str>,
    ) -> Result<PushResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        let branch = match branch {
            Some(b) => b.to_string(),
            None => self.branch_info(false).await?.current,
        };
        let remote = remote.unwrap_or("origin").to_string();
        let remote_branch = match self.tracking_branches().await {
            Ok(tracking) => tracking
                .into_iter()
                .find(|t| t.branch == branch && !t.tracks_local_branch())
                .map(|t| t.remote_branch),
            Err(err) => {
                tracing::debug!(error = %err, "upstream lookup failed before push");
                None
            }
        };
        let refspec = format!("{branch}:{}", remote_branch.as_deref().unwrap_or(&branch));

        match self
            .git_unbounded(argv!["push", END_OF_OPTIONS, &remote, refspec])
            .await
        {
            Ok(_) => Ok(PushResult::Success { branch, remote }),
            Err(err)
                if err.stderr().contains("non-fast-forward")
                    || err.stderr().contains("rejected") =>
            {
                Ok(PushResult::Rejected {
                    message: err.to_string(),
                })
            }
            Err(err) => Err(err.into()),
        }
    }
}

/// Reads a successful `git pull`'s diffstat: no changes means it was already
/// up to date.
pub(super) fn pull_result(output: &str) -> PullResult {
    let summary = parse_diff_stat_summary(output);
    if summary.changes == 0 && summary.insertions == 0 && summary.deletions == 0 {
        return PullResult::UpToDate;
    }
    PullResult::Success {
        summary: PullSummary {
            changes: summary.changes,
            insertions: summary.insertions,
            deletions: summary.deletions,
        },
    }
}

#[cfg(test)]
#[path = "sync_tests.rs"]
mod tests;
