//! `GitService`: git operations over `exec_git` + explicit porcelain parsing
//! (no `simple-git`). Error strings are kept stable for callers that classify
//! them.

use crate::git_parse::parse_worktree_list;
use std::future::Future;
use std::path::Path;

use mainframe_types::git::{
    ActiveOperation, BranchInfo, BranchListResult, BranchUpdateStatus, BranchUpdateStatusKind,
    DeleteBranchResult, FetchResult, MergeResult, MergeSummary, PullResult, PullSummary,
    PushResult, RebaseResult, UpdateAllResult, WorkingStat, WorkingStatFile,
};
use serde::{Deserialize, Serialize};

use crate::git_exec::{GitExecError, GitExecOptions, exec_git};
use crate::git_parse::{
    BranchList, PorcelainStatus, RemoteUrl, count_auto_merges, js_parse_int, parse_branch_list,
    parse_commit_hash, parse_diff_stat_summary, parse_remote_urls, parse_remotes, parse_status_z,
};
use crate::project_lock::acquire_project_lock;

/// Build a `Vec<String>` from string literals.
macro_rules! argv {
    ($($x:expr),* $(,)?) => { vec![$($x.to_string()),*] };
}

/// Network/mutation ops may run past the read-command default timeout; leave
/// uncapped (`{ timeout: 0 }`).
const NO_TIMEOUT: Option<GitExecOptions> = Some(GitExecOptions { timeout: Some(0) });

/// `detect_base_branch()`'s result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedBaseBranch {
    pub base_branch: String,
    pub merge_base: String,
}

/// `abort()`'s result.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AbortResult {
    pub aborted: bool,
}

/// Errors from `GitService` methods: a wrapped `exec_git` failure, or a
/// service-level error message (e.g. "Nothing to commit").
#[derive(Debug, thiserror::Error)]
pub enum GitServiceError {
    #[error(transparent)]
    Exec(#[from] GitExecError),
    #[error("{0}")]
    Other(String),
}

/// The single subprocess seam. Production uses [`RealGitExec`] (→ [`exec_git`]);
/// tests inject a recording/dispatching fake to assert the exact git argv.
pub trait GitExec: Send + Sync {
    fn exec(
        &self,
        args: Vec<String>,
        cwd: String,
        opts: Option<GitExecOptions>,
    ) -> impl Future<Output = Result<String, GitExecError>> + Send;
}

/// The production executor: shells out via [`exec_git`].
#[derive(Debug, Clone, Copy, Default)]
pub struct RealGitExec;

impl GitExec for RealGitExec {
    async fn exec(
        &self,
        args: Vec<String>,
        cwd: String,
        opts: Option<GitExecOptions>,
    ) -> Result<String, GitExecError> {
        exec_git(&args, &cwd, opts).await
    }
}

pub struct GitService<E = RealGitExec> {
    project_path: String,
    exec: E,
}

impl GitService<RealGitExec> {
    pub fn for_project(project_path: impl Into<String>) -> Self {
        Self {
            project_path: project_path.into(),
            exec: RealGitExec,
        }
    }
}

impl<E: GitExec> GitService<E> {
    /// Test-only constructor injecting a custom executor.
    #[cfg(test)]
    fn with_exec(project_path: String, exec: E) -> Self {
        Self { project_path, exec }
    }

    async fn git(
        &self,
        args: Vec<String>,
        opts: Option<GitExecOptions>,
    ) -> Result<String, GitExecError> {
        self.exec.exec(args, self.project_path.clone(), opts).await
    }

    async fn branch_info(&self, all: bool) -> Result<BranchList, GitExecError> {
        let args = if all {
            argv!["branch", "--no-color", "-a"]
        } else {
            argv!["branch", "--no-color"]
        };
        Ok(parse_branch_list(&self.git(args, None).await?))
    }

    /// Unmerged (conflicted) paths in the working tree, used to classify failures.
    async fn unmerged_paths(&self) -> Result<Vec<String>, GitExecError> {
        Ok(self
            .git(argv!["diff", "--name-only", "--diff-filter=U"], None)
            .await?
            .split('\n')
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect())
    }

    pub async fn current_branch(&self) -> Result<String, GitServiceError> {
        Ok(self.branch_info(false).await?.current)
    }

    pub async fn status_raw(&self) -> Result<String, GitServiceError> {
        Ok(self.git(argv!["status", "--porcelain"], None).await?)
    }

    pub async fn status(&self) -> Result<PorcelainStatus, GitServiceError> {
        Ok(parse_status_z(
            &self.git(argv!["status", "--porcelain", "-z"], None).await?,
        ))
    }

    pub async fn branches(&self) -> Result<BranchListResult, GitServiceError> {
        let info = self.branch_info(true).await?;
        let mut local: Vec<BranchInfo> = Vec::new();
        let mut remote: Vec<String> = Vec::new();

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

        for name in &info.all {
            if name.starts_with("remotes/") {
                // Skip pseudo-refs like "remotes/origin/HEAD -> origin/main".
                if name.contains(" -> ") || name.ends_with("/HEAD") {
                    continue;
                }
                let remote_name = name.strip_prefix("remotes/").unwrap_or(name).to_string();
                remote.push(remote_name);
            } else {
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

        Ok(BranchListResult {
            current: info.current,
            local,
            remote,
            worktrees: worktree_names,
            active_operation,
        })
    }

    pub async fn stage(&self, files: &[String]) -> Result<(), GitServiceError> {
        let mut args = argv!["add"];
        args.extend(files.iter().cloned());
        self.git(args, None).await?;
        Ok(())
    }

    pub async fn unstage(&self, files: &[String]) -> Result<(), GitServiceError> {
        if files.is_empty() {
            return Ok(());
        }
        let mut args = argv!["reset", "HEAD", "--"];
        args.extend(files.iter().cloned());
        self.git(args, None).await?;
        Ok(())
    }

    // `-c core.abbrev=40` forces the full 40-char SHA in `git commit`'s output.
    pub async fn commit(&self, message: &str) -> Result<String, GitServiceError> {
        Ok(parse_commit_hash(
            &self
                .git(argv!["-c", "core.abbrev=40", "commit", "-m", message], None)
                .await?,
        ))
    }

    /// Stage every change (tracked edits, new files, and deletions) and commit.
    /// Throws when there is nothing to commit.
    pub async fn commit_all(&self, message: &str) -> Result<String, GitServiceError> {
        self.git(argv!["add", "-A"], None).await?;
        let commit = parse_commit_hash(
            &self
                .git(argv!["-c", "core.abbrev=40", "commit", "-m", message], None)
                .await?,
        );
        if commit.is_empty() {
            return Err(GitServiceError::Other("Nothing to commit".to_string()));
        }
        Ok(commit)
    }

    /// Per-file addition/deletion counts for the working tree (vs HEAD), plus
    /// totals. Tracked changes come from `git diff --numstat HEAD`; untracked
    /// files are line-counted directly. Binary files report 0/0.
    pub async fn working_stat(&self) -> Result<WorkingStat, GitServiceError> {
        let mut files: Vec<WorkingStatFile> = Vec::new();

        let numstat = self.git(argv!["diff", "--numstat", "HEAD"], None).await?;
        for line in numstat.split('\n').filter(|l| !l.is_empty()) {
            let parts: Vec<&str> = line.split('\t').collect();
            let add_str = parts.first().copied().unwrap_or("");
            let del_str = parts.get(1).copied().unwrap_or("");
            let path = if parts.len() > 2 {
                parts[2..].join("\t")
            } else {
                String::new()
            };
            if path.is_empty() {
                continue;
            }
            files.push(WorkingStatFile {
                path,
                additions: if add_str == "-" {
                    0
                } else {
                    js_parse_int(add_str)
                },
                deletions: if del_str == "-" {
                    0
                } else {
                    js_parse_int(del_str)
                },
            });
        }

        // Untracked files (`-uall` lists individual files inside new directories).
        let status = self
            .git(argv!["status", "--porcelain", "-uall"], None)
            .await?;
        for line in status.split('\n').filter(|l| !l.is_empty()) {
            if !line.starts_with("??") {
                continue;
            }
            let path: String = line.chars().skip(3).collect();
            if path.is_empty() || path.ends_with('/') {
                continue;
            }
            let additions = self.count_untracked_additions(&path).await;
            files.push(WorkingStatFile {
                path,
                additions,
                deletions: 0,
            });
        }

        let total_additions = files.iter().map(|f| f.additions).sum();
        let total_deletions = files.iter().map(|f| f.deletions).sum();
        Ok(WorkingStat {
            files,
            total_additions,
            total_deletions,
        })
    }

    /// Lines in an untracked file; 0 for binary (null-byte) or empty files.
    async fn count_untracked_additions(&self, rel_path: &str) -> i64 {
        match tokio::fs::read(Path::new(&self.project_path).join(rel_path)).await {
            Ok(buf) => {
                if buf.contains(&0) {
                    return 0;
                }
                let text = String::from_utf8_lossy(&buf);
                if text.is_empty() {
                    return 0;
                }
                let lines = text.split('\n').count() as i64;
                lines - if text.ends_with('\n') { 1 } else { 0 }
            }
            // expected — file may have vanished between status and read
            Err(_) => 0,
        }
    }

    pub async fn diff(&self, args: &[String]) -> Result<String, GitServiceError> {
        let mut a = argv!["diff"];
        a.extend(args.iter().cloned());
        Ok(self.git(a, None).await?)
    }

    pub async fn show(&self, git_ref: &str) -> Result<String, GitServiceError> {
        Ok(self.git(argv!["show", git_ref], None).await?)
    }

    pub async fn merge_base(
        &self,
        branch1: &str,
        branch2: &str,
    ) -> Result<Option<String>, GitServiceError> {
        match self.git(argv!["merge-base", branch1, branch2], None).await {
            Ok(out) => Ok(Some(out.trim().to_string())),
            // expected — branches may share no common ancestor
            Err(_) => Ok(None),
        }
    }

    /// Tries 'main' then 'master' to find a common merge-base with HEAD.
    pub async fn detect_base_branch(&self) -> Result<Option<DetectedBaseBranch>, GitServiceError> {
        for base in ["main", "master"] {
            if let Some(sha) = self.merge_base(base, "HEAD").await? {
                return Ok(Some(DetectedBaseBranch {
                    base_branch: base.to_string(),
                    merge_base: sha,
                }));
            }
        }
        Ok(None)
    }

    /// Every remote's name and URL, deduped across the fetch/push pair `git
    /// remote -v` prints for each. No filtering — callers derive `owner/repo`
    /// (e.g. `github_repo_from_url`) themselves.
    pub async fn remotes_with_urls(&self) -> Result<Vec<RemoteUrl>, GitServiceError> {
        Ok(parse_remote_urls(
            &self.git(argv!["remote", "-v"], None).await?,
        ))
    }

    pub async fn checkout(&self, branch: &str) -> Result<(), GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        // If it looks like a remote ref (e.g. "origin/feat/foo"), strip the
        // remote name and checkout the local name so git creates a tracking
        // branch. Verify the prefix is an actual remote to avoid false positives.
        if let Some((remote, local_name)) = branch.split_once('/')
            && !remote.is_empty()
            && !local_name.is_empty()
        {
            let remotes = parse_remotes(&self.git(argv!["remote"], None).await?);
            if remotes.iter().any(|r| r == remote) {
                match self
                    .git(argv!["checkout", "-b", local_name, branch, "--track"], None)
                    .await
                {
                    Ok(_) => return Ok(()),
                    Err(err) => {
                        if err.message.contains("already exists") {
                            self.git(argv!["checkout", local_name], None).await?;
                            return Ok(());
                        } else {
                            return Err(err.into());
                        }
                    }
                }
            }
        }
        self.git(argv!["checkout", branch], None).await?;
        Ok(())
    }

    pub async fn create_branch(
        &self,
        name: &str,
        start_point: Option<&str>,
    ) -> Result<(), GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        if let Some(start) = start_point {
            self.git(argv!["checkout", "-b", name, start], None).await?;
        } else {
            self.git(argv!["checkout", "-b", name], None).await?;
        }
        Ok(())
    }

    pub async fn fetch(&self, remote: Option<&str>) -> Result<FetchResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        if let Some(r) = remote {
            self.git(argv!["fetch", r, "--prune"], NO_TIMEOUT).await?;
        } else {
            self.git(argv!["fetch", "--all", "--prune"], NO_TIMEOUT)
                .await?;
        }
        Ok(FetchResult::Success {
            remote: remote.unwrap_or("all").to_string(),
        })
    }

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
                return Ok(PullResult::Success {
                    summary: PullSummary {
                        changes: 0,
                        insertions: 0,
                        deletions: 0,
                    },
                });
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

        // Look up the tracking branch to build a correct refspec when the local
        // and remote branch names differ.
        let mut remote_branch = current_branch.clone();
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

    pub async fn merge(&self, branch: &str) -> Result<MergeResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        match self.git(argv!["merge", branch], NO_TIMEOUT).await {
            Ok(output) => {
                let summary = parse_diff_stat_summary(&output);
                Ok(MergeResult::Success {
                    summary: MergeSummary {
                        commits: count_auto_merges(&output) as i64,
                        insertions: summary.insertions,
                        deletions: summary.deletions,
                    },
                })
            }
            Err(err) => {
                let conflicts = self.unmerged_paths().await?;
                if !conflicts.is_empty() {
                    Ok(MergeResult::Conflict {
                        conflicts,
                        message: err.message.clone(),
                    })
                } else {
                    Err(err.into())
                }
            }
        }
    }

    pub async fn rebase(&self, branch: &str) -> Result<RebaseResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        match self.git(argv!["rebase", branch], NO_TIMEOUT).await {
            Ok(_) => Ok(RebaseResult::Success),
            Err(err) => match self.git(argv!["rev-parse", "--git-dir"], None).await {
                Ok(git_dir_raw) => {
                    let git_dir = git_dir_raw.trim();
                    if fs_exists(&Path::new(git_dir).join("rebase-merge")).await {
                        match self.status().await {
                            Ok(status_result) => Ok(RebaseResult::Conflict {
                                conflicts: status_result.conflicted,
                                message: err.message.clone(),
                            }),
                            // inner catch → throw the original err
                            Err(_) => Err(err.into()),
                        }
                    } else {
                        Err(err.into())
                    }
                }
                Err(_) => Err(err.into()),
            },
        }
    }

    pub async fn abort(&self) -> Result<AbortResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        // `git rev-parse --git-dir` works in worktrees where .git is a file.
        let git_dir_raw = self.git(argv!["rev-parse", "--git-dir"], None).await?;
        let git_dir = git_dir_raw.trim();
        if fs_exists(&Path::new(git_dir).join("MERGE_HEAD")).await
            && self.git(argv!["merge", "--abort"], None).await.is_ok()
        {
            return Ok(AbortResult { aborted: true });
        }
        if fs_exists(&Path::new(git_dir).join("rebase-merge")).await
            && self.git(argv!["rebase", "--abort"], None).await.is_ok()
        {
            return Ok(AbortResult { aborted: true });
        }
        if fs_exists(&Path::new(git_dir).join("rebase-apply")).await
            && self.git(argv!["rebase", "--abort"], None).await.is_ok()
        {
            return Ok(AbortResult { aborted: true });
        }
        Ok(AbortResult { aborted: false })
    }

    pub async fn rename_branch(
        &self,
        old_name: &str,
        new_name: &str,
    ) -> Result<(), GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        self.git(argv!["branch", "-m", old_name, new_name], None)
            .await?;
        Ok(())
    }

    pub async fn delete_branch(
        &self,
        name: &str,
        force: bool,
        is_remote: bool,
    ) -> Result<DeleteBranchResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        if is_remote {
            match name.split_once('/') {
                Some((remote, branch_name)) if !remote.is_empty() && !branch_name.is_empty() => {
                    self.git(argv!["push", remote, "--delete", branch_name], NO_TIMEOUT)
                        .await?;
                    Ok(DeleteBranchResult::Success)
                }
                _ => Err(GitServiceError::Other(format!(
                    "Invalid remote branch name: {name}"
                ))),
            }
        } else {
            let flag = if force { "-D" } else { "-d" };
            match self.git(argv!["branch", flag, name], None).await {
                Ok(_) => Ok(DeleteBranchResult::Success),
                Err(err) => {
                    if err.message.contains("not fully merged") {
                        Ok(DeleteBranchResult::NotMerged {
                            message: err.message,
                        })
                    } else if err.message.contains("used by worktree") {
                        Ok(DeleteBranchResult::IsCurrent {
                            message: "Cannot delete the currently checked-out branch".to_string(),
                        })
                    } else {
                        Err(err.into())
                    }
                }
            }
        }
    }

    pub async fn update_all(&self) -> Result<UpdateAllResult, GitServiceError> {
        let _guard = acquire_project_lock(&self.project_path).await;
        let mut fetched = false;
        match self
            .git(argv!["fetch", "--all", "--prune"], NO_TIMEOUT)
            .await
        {
            Ok(_) => fetched = true,
            Err(err) => tracing::warn!(?err, "fetch --all failed during updateAll"),
        }

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
                    tracing::warn!(?err, "pull failed during updateAll");
                    pull = PullResult::UpToDate;
                }
            }
        }

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
                    let updated: Result<BranchUpdateStatusKind, GitExecError> = async {
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
                    .await;
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
            Err(err) => tracing::warn!(?err, "branch enumeration failed during updateAll"),
        }

        Ok(UpdateAllResult {
            fetched,
            pull,
            branches,
        })
    }
}

/// `path.basename` — the final component of a path.
fn basename(p: &str) -> String {
    Path::new(p)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// `await access(path)` — true when the path exists / is reachable.
async fn fs_exists(path: &Path) -> bool {
    tokio::fs::metadata(path).await.is_ok()
}

#[cfg(test)]
#[path = "git_service_mock_tests.rs"]
mod mock_tests;

// Real-git temp-repo integration tests.
#[cfg(test)]
#[path = "git_service_review_tests.rs"]
mod review_tests;
