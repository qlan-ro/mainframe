use super::*;

impl<E: GitExec> GitService<E> {
    pub async fn branches(&self) -> Result<BranchListResult, GitServiceError> {
        let info = self.branch_info(true).await?;
        let mut local: Vec<BranchInfo> = Vec::new();
        let mut remote: Vec<String> = Vec::new();

        let (branch_to_worktree, worktree_names) = self.branch_worktrees().await;

        for name in &info.all {
            if name.starts_with("remotes/") {
                // Skip pseudo-refs like "remotes/origin/HEAD -> origin/main".
                if name.contains(" -> ") || name.ends_with("/HEAD") {
                    continue;
                }
                let remote_name = name.strip_prefix("remotes/").unwrap_or(name).to_string();
                remote.push(remote_name);
            } else {
                let (tracking, ahead, behind) = self.branch_tracking(name).await?;
                local.push(BranchInfo {
                    name: name.clone(),
                    current: *name == info.current,
                    tracking,
                    ahead,
                    behind,
                    worktree: branch_to_worktree.get(name).cloned(),
                });
            }
        }

        let active_operation = self.active_operation().await;

        Ok(BranchListResult {
            current: info.current,
            local,
            remote,
            worktrees: worktree_names,
            active_operation,
        })
    }
    pub(super) async fn branch_worktrees(
        &self,
    ) -> (std::collections::HashMap<String, String>, Vec<String>) {
        // Build branch → worktree dirname map from `git worktree list`.
        let mut branch_to_worktree: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        let mut worktree_names: Vec<String> = Vec::new();
        if let Ok(wt_output) = self
            .git(argv!["worktree", "list", "--porcelain"], None)
            .await
        {
            let entries = parse_worktree_list(&wt_output);
            for (i, entry) in entries.iter().enumerate() {
                // Skip the main worktree (always the first entry).
                if i == 0 {
                    continue;
                }
                let Some(branch) = &entry.branch else {
                    continue;
                };
                let branch_name = branch
                    .strip_prefix("refs/heads/")
                    .unwrap_or(branch)
                    .to_string();
                let dir_name = basename(&entry.path);
                branch_to_worktree.insert(branch_name, dir_name.clone());
                if !worktree_names.contains(&dir_name) {
                    worktree_names.push(dir_name);
                }
            }
        }

        (branch_to_worktree, worktree_names)
    }

    pub(super) async fn branch_tracking(
        &self,
        name: &str,
    ) -> Result<(Option<String>, Option<i64>, Option<i64>), GitServiceError> {
        let mut tracking: Option<String> = None;
        let mut ahead: Option<i64> = None;
        let mut behind: Option<i64> = None;
        if let Ok(upstream_raw) = self
            .git(
                argv!["rev-parse", "--abbrev-ref", format!("{name}@{{upstream}}")],
                None,
            )
            .await
        {
            let upstream = upstream_raw.trim();
            if !upstream.is_empty() {
                tracking = Some(upstream.to_string());
                let counts_raw = self
                    .git(
                        argv![
                            "rev-list",
                            "--left-right",
                            "--count",
                            format!("{name}...{upstream}")
                        ],
                        None,
                    )
                    .await?;
                let counts = counts_raw.trim();
                let mut parts = counts.split_whitespace();
                let a = parts.next().unwrap_or("");
                let b = parts.next().unwrap_or("");
                ahead = Some(js_parse_int(a));
                behind = Some(js_parse_int(b));
            }
        }
        Ok((tracking, ahead, behind))
    }

    pub(super) async fn active_operation(&self) -> Option<ActiveOperation> {
        // Detect active merge/rebase operation.
        let mut active_operation: Option<ActiveOperation> = None;
        if let Ok(git_dir_raw) = self.git(argv!["rev-parse", "--git-dir"], None).await {
            let git_dir = git_dir_raw.trim();
            if fs_exists(&Path::new(git_dir).join("MERGE_HEAD")).await {
                active_operation = Some(ActiveOperation::Merge);
            }
            if active_operation.is_none()
                && fs_exists(&Path::new(git_dir).join("rebase-merge")).await
            {
                active_operation = Some(ActiveOperation::Rebase);
            }
            if active_operation.is_none()
                && fs_exists(&Path::new(git_dir).join("rebase-apply")).await
            {
                active_operation = Some(ActiveOperation::Rebase);
            }
        }

        active_operation
    }
}
