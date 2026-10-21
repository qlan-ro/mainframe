//! Branch listing and branch mutations.

use std::collections::HashMap;
use std::path::Path;

use mainframe_types::git::{BranchInfo, BranchListResult, DeleteBranchResult};

use super::{END_OF_OPTIONS, GitExec, GitService, GitServiceError};
use crate::git_exec::GitExecError;
use crate::git_parse::{
    BranchTracking, TRACKING_FORMAT, parse_branch_tracking, parse_remotes, parse_worktree_list,
};
use crate::project_lock::acquire_project_lock;

/// Linked worktrees, keyed by the branch each has checked out.
struct Worktrees {
    dir_by_branch: HashMap<String, String>,
    /// Directory names in `git worktree list` order, without duplicates.
    dir_names: Vec<String>,
}

impl<E: GitExec> GitService<E> {
    pub async fn branches(&self) -> Result<BranchListResult, GitServiceError> {
        let info = self.branch_info(true).await?;
        let mut tracking: HashMap<String, BranchTracking> = self
            .tracking_branches()
            .await?
            .into_iter()
            .map(|t| (t.branch.clone(), t))
            .collect();
        let worktrees = self.worktrees().await;

        let mut local = Vec::new();
        let mut remote = Vec::new();
        for name in info.all {
            if let Some(remote_name) = name.strip_prefix("remotes/") {
                // Skip pseudo-refs like "remotes/origin/HEAD -> origin/main".
                if !name.contains(" -> ") && !name.ends_with("/HEAD") {
                    remote.push(remote_name.to_string());
                }
                continue;
            }
            let (upstream, ahead, behind) = match tracking.remove(&name) {
                Some(t) => (Some(t.upstream), Some(t.ahead), Some(t.behind)),
                None => (None, None, None),
            };
            local.push(BranchInfo {
                current: name == info.current,
                tracking: upstream,
                ahead,
                behind,
                worktree: worktrees.dir_by_branch.get(&name).cloned(),
                name,
            });
        }

        Ok(BranchListResult {
            current: info.current,
            local,
            remote,
            worktrees: worktrees.dir_names,
            active_operation: self.active_operation().await,
        })
    }

    /// Every local branch with a live upstream, in branch-name order.
    pub(super) async fn tracking_branches(&self) -> Result<Vec<BranchTracking>, GitExecError> {
        let out = self
            .git(argv!["for-each-ref", TRACKING_FORMAT, "refs/heads"])
            .await?;
        Ok(parse_branch_tracking(&out))
    }

    /// Linked worktrees; empty when `git worktree list` fails.
    async fn worktrees(&self) -> Worktrees {
        let mut worktrees = Worktrees {
            dir_by_branch: HashMap::new(),
            dir_names: Vec::new(),
        };
        let output = match self.git(argv!["worktree", "list", "--porcelain"]).await {
            Ok(output) => output,
            Err(err) => {
                tracing::debug!(error = %err, "git worktree list failed");
                return worktrees;
            }
        };
        // The first entry is the main worktree.
        for entry in parse_worktree_list(&output).into_iter().skip(1) {
            let Some(branch) = entry.branch else {
                continue;
            };
            let dir_name = Path::new(&entry.path)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let branch = branch.strip_prefix("refs/heads/").unwrap_or(&branch);
            worktrees
                .dir_by_branch
                .insert(branch.to_string(), dir_name.clone());
            if !worktrees.dir_names.contains(&dir_name) {
                worktrees.dir_names.push(dir_name);
            }
        }
        worktrees
    }

    /// Checks out `branch`. A remote ref such as `origin/feat/foo` checks out
    /// (creating if needed) the local branch `feat/foo` tracking it.
    pub async fn checkout(&self, branch: &str) -> Result<(), GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        if let Some((remote, local_name)) = branch.split_once('/')
            && !remote.is_empty()
            && !local_name.is_empty()
            && parse_remotes(&self.git(argv!["remote"]).await?).contains(&remote.to_string())
        {
            let created = self
                .git(argv![
                    "checkout",
                    "--track",
                    "-b",
                    local_name,
                    END_OF_OPTIONS,
                    branch
                ])
                .await;
            match created {
                Ok(_) => return Ok(()),
                Err(err) if err.stderr().contains("already exists") => {
                    self.git(argv!["checkout", END_OF_OPTIONS, local_name])
                        .await?;
                    return Ok(());
                }
                Err(err) => return Err(err.into()),
            }
        }
        self.git(argv!["checkout", END_OF_OPTIONS, branch]).await?;
        Ok(())
    }

    pub async fn create_branch(
        &self,
        name: &str,
        start_point: Option<&str>,
    ) -> Result<(), GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        let mut args = argv!["checkout", "-b", name, END_OF_OPTIONS];
        args.extend(start_point.map(String::from));
        self.git(args).await?;
        Ok(())
    }

    pub async fn rename_branch(
        &self,
        old_name: &str,
        new_name: &str,
    ) -> Result<(), GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        self.git(argv!["branch", "-m", END_OF_OPTIONS, old_name, new_name])
            .await?;
        Ok(())
    }

    /// Deletes a local branch, or with `is_remote` a `<remote>/<branch>` ref on
    /// its remote.
    pub async fn delete_branch(
        &self,
        name: &str,
        force: bool,
        is_remote: bool,
    ) -> Result<DeleteBranchResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        if is_remote {
            let Some((remote, branch)) = name
                .split_once('/')
                .filter(|(remote, branch)| !remote.is_empty() && !branch.is_empty())
            else {
                return Err(GitServiceError::InvalidRemoteBranch(name.to_string()));
            };
            self.git_unbounded(argv!["push", "--delete", END_OF_OPTIONS, remote, branch])
                .await?;
            return Ok(DeleteBranchResult::Success);
        }
        let flag = if force { "-D" } else { "-d" };
        match self.git(argv!["branch", flag, END_OF_OPTIONS, name]).await {
            Ok(_) => Ok(DeleteBranchResult::Success),
            Err(err) if err.stderr().contains("not fully merged") => {
                Ok(DeleteBranchResult::NotMerged {
                    message: err.to_string(),
                })
            }
            Err(err) if err.stderr().contains("used by worktree") => {
                Ok(DeleteBranchResult::IsCurrent {
                    message: "Cannot delete the currently checked-out branch".to_string(),
                })
            }
            Err(err) => Err(err.into()),
        }
    }
}

#[cfg(test)]
#[path = "branches_tests.rs"]
mod tests;
