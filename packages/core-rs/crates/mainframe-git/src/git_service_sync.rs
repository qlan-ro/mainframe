use super::*;

impl<E: GitExec> GitService<E> {
    pub async fn pull(
        &self,
        remote: Option<&str>,
        branch: Option<&str>,
        local_branch: Option<&str>,
    ) -> Result<PullResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        // When a local branch is specified and differs from the current branch,
        // use `git fetch remote remoteBranch:localBranch` to fast-forward the
        // target ref without switching the working tree.
        if let (Some(local), Some(br)) = (local_branch, branch) {
            let current_branch = self.branch_info(false).await?.current;
            if current_branch != local {
                return self.pull_other_branch(local, br, remote).await;
            }
        }

        let mut args = argv!["pull"];
        if let Some(r) = remote {
            args.push(r.to_string());
        }
        if let Some(b) = branch {
            args.push(b.to_string());
        }
        args.push("--ff-only".to_string());
        match self.git(args, NO_TIMEOUT).await {
            Ok(out) => {
                let summary = parse_diff_stat_summary(&out);
                if summary.changes == 0 && summary.insertions == 0 && summary.deletions == 0 {
                    Ok(PullResult::UpToDate)
                } else {
                    Ok(PullResult::Success {
                        summary: PullSummary {
                            changes: summary.changes,
                            insertions: summary.insertions,
                            deletions: summary.deletions,
                        },
                    })
                }
            }
            Err(err) => {
                let conflicts = self.unmerged_paths().await?;
                if !conflicts.is_empty() {
                    Ok(PullResult::Conflict {
                        conflicts,
                        message: err.message.clone(),
                    })
                } else {
                    Err(err.into())
                }
            }
        }
    }

    pub(super) async fn pull_other_branch(
        &self,
        local: &str,
        br: &str,
        remote: Option<&str>,
    ) -> Result<PullResult, GitServiceError> {
        let pull_remote = remote.unwrap_or("origin");
        let ref_before = self
            .git(argv!["rev-parse", local], None)
            .await?
            .trim()
            .to_string();
        self.git(
            argv!["fetch", pull_remote, format!("{br}:{local}")],
            NO_TIMEOUT,
        )
        .await?;
        let ref_after = self
            .git(argv!["rev-parse", local], None)
            .await?
            .trim()
            .to_string();
        if ref_before == ref_after {
            return Ok(PullResult::UpToDate);
        }
        Ok(PullResult::Success {
            summary: PullSummary {
                changes: 0,
                insertions: 0,
                deletions: 0,
            },
        })
    }

    pub async fn push(
        &self,
        branch: Option<&str>,
        remote: Option<&str>,
    ) -> Result<PushResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        let current_branch = match branch {
            Some(b) => b.to_string(),
            None => self.branch_info(false).await?.current,
        };
        let push_remote = remote.unwrap_or("origin").to_string();

        let remote_branch = self.push_remote_branch(&current_branch).await;

        match self
            .git(
                argv![
                    "push",
                    push_remote.clone(),
                    format!("{current_branch}:{remote_branch}")
                ],
                NO_TIMEOUT,
            )
            .await
        {
            Ok(_) => Ok(PushResult::Success {
                branch: current_branch,
                remote: push_remote,
            }),
            Err(err) => {
                if err.message.contains("non-fast-forward") || err.message.contains("rejected") {
                    Ok(PushResult::Rejected {
                        message: err.message,
                    })
                } else {
                    Err(err.into())
                }
            }
        }
    }

    pub(super) async fn push_remote_branch(&self, current_branch: &str) -> String {
        // Look up the tracking branch to build a correct refspec when the local
        // and remote branch names differ.
        let mut remote_branch = current_branch.to_string();
        if let Ok(upstream_raw) = self
            .git(
                argv![
                    "rev-parse",
                    "--abbrev-ref",
                    format!("{current_branch}@{{upstream}}")
                ],
                None,
            )
            .await
        {
            let upstream = upstream_raw.trim();
            if !upstream.is_empty()
                && let Some(idx) = upstream.find('/')
                && idx > 0
            {
                remote_branch = upstream[idx + 1..].to_string();
            }
        }

        remote_branch
    }
}
