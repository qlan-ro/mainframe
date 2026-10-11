use super::*;

impl<E: GitExec> GitService<E> {
    pub async fn update_all(&self) -> Result<UpdateAllResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        let mut fetched = false;
        match self
            .git(argv!["fetch", "--all", "--prune"], NO_TIMEOUT)
            .await
        {
            Ok(_) => fetched = true,
            Err(err) => tracing::warn!(error = ?err, "fetch --all failed during updateAll"),
        }

        let pull = self.pull_for_update().await?;

        let branches = self.update_tracking_branches().await;

        Ok(UpdateAllResult {
            fetched,
            pull,
            branches,
        })
    }

    pub(super) async fn pull_for_update(&self) -> Result<PullResult, GitServiceError> {
        // Pull current branch.
        let pull: PullResult;
        match self.git(argv!["pull", "--ff-only"], NO_TIMEOUT).await {
            Ok(out) => {
                let summary = parse_diff_stat_summary(&out);
                pull = if summary.changes == 0 && summary.insertions == 0 && summary.deletions == 0
                {
                    PullResult::UpToDate
                } else {
                    PullResult::Success {
                        summary: PullSummary {
                            changes: summary.changes,
                            insertions: summary.insertions,
                            deletions: summary.deletions,
                        },
                    }
                };
            }
            Err(err) => {
                let conflicts = self.unmerged_paths().await?;
                if !conflicts.is_empty() {
                    pull = PullResult::Conflict {
                        conflicts,
                        message: err.message.clone(),
                    };
                } else {
                    tracing::warn!(error = ?err, "pull failed during updateAll");
                    pull = PullResult::UpToDate;
                }
            }
        }

        Ok(pull)
    }

    pub(super) async fn update_tracking_branches(&self) -> Vec<BranchUpdateStatus> {
        // Fast-forward all non-current local branches that have tracking remotes.
        let mut branches: Vec<BranchUpdateStatus> = Vec::new();
        match self.branch_info(true).await {
            Ok(branch_result) => {
                let current_branch = branch_result.current.clone();
                for name in &branch_result.all {
                    if name.starts_with("remotes/") || *name == current_branch {
                        continue;
                    }
                    let upstream = match self
                        .git(
                            argv!["rev-parse", "--abbrev-ref", format!("{name}@{{upstream}}")],
                            None,
                        )
                        .await
                    {
                        Ok(u) => u.trim().to_string(),
                        Err(_) => continue, // no tracking remote
                    };
                    let idx = match upstream.find('/') {
                        Some(i) if i > 0 => i,
                        _ => continue,
                    };
                    let remote = &upstream[..idx];
                    let remote_branch = &upstream[idx + 1..];
                    let updated = self.fast_forward_ref(name, remote, remote_branch).await;
                    match updated {
                        Ok(status) => branches.push(BranchUpdateStatus {
                            branch: name.clone(),
                            status,
                            error: None,
                        }),
                        Err(err) => branches.push(BranchUpdateStatus {
                            branch: name.clone(),
                            status: BranchUpdateStatusKind::Error,
                            error: Some(err.message),
                        }),
                    }
                }
            }
            Err(err) => tracing::warn!(error = ?err, "branch enumeration failed during updateAll"),
        }

        branches
    }

    pub(super) async fn fast_forward_ref(
        &self,
        name: &str,
        remote: &str,
        remote_branch: &str,
    ) -> Result<BranchUpdateStatusKind, GitExecError> {
        let ref_before = self
            .git(argv!["rev-parse", name], None)
            .await?
            .trim()
            .to_string();
        self.git(
            argv!["fetch", remote, format!("{remote_branch}:{name}")],
            NO_TIMEOUT,
        )
        .await?;
        let ref_after = self
            .git(argv!["rev-parse", name], None)
            .await?
            .trim()
            .to_string();
        Ok(if ref_before == ref_after {
            BranchUpdateStatusKind::UpToDate
        } else {
            BranchUpdateStatusKind::Updated
        })
    }
}
