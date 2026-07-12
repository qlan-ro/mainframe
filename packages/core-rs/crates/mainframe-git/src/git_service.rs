//! Ported from `packages/core/src/git/git-service.ts`.
//!
//! Every public method keeps the TS name, argument order, control flow, and
//! error strings. `GitService` was converted off `simple-git` onto `execGit` +
//! explicit porcelain parsing in Phase 0 — this ports *our* parsers only.

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
    BranchList, PorcelainStatus, count_auto_merges, js_parse_int, parse_branch_list,
    parse_commit_hash, parse_diff_stat_summary, parse_remotes, parse_status_z,
};
use crate::project_lock::acquire_project_lock;

/// Build a `Vec<String>` from string literals (mirrors the TS array literals).
macro_rules! argv {
    ($($x:expr),* $(,)?) => { vec![$($x.to_string()),*] };
}

/// Network/mutation ops may run past the read-command default timeout; leave
/// uncapped (`{ timeout: 0 }`).
const NO_TIMEOUT: Option<GitExecOptions> = Some(GitExecOptions { timeout: Some(0) });

/// `detectBaseBranch()`'s result — the TS inline `{ baseBranch, mergeBase }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedBaseBranch {
    pub base_branch: String,
    pub merge_base: String,
}

/// `abort()`'s result — the TS inline `{ aborted }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AbortResult {
    pub aborted: bool,
}

/// Errors thrown by `GitService` methods: a wrapped `execGit` rejection, or a
/// service-level `throw new Error(...)` (e.g. "Nothing to commit").
#[derive(Debug, thiserror::Error)]
pub enum GitServiceError {
    #[error(transparent)]
    Exec(#[from] GitExecError),
    #[error("{0}")]
    Other(String),
}

/// The single subprocess seam. Production uses [`RealGitExec`] (→ [`exec_git`]);
/// tests inject a recording/dispatching fake to assert the exact git argv.
///
/// This trait is a Rust-port testability seam with no TS counterpart.
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

// ---------------------------------------------------------------------------
// Local port of `workspace/worktree.ts::parseWorktreeList`.
//
// The canonical home is `mainframe-services::workspace::worktree`, but that
// module also depends on `exec_git` (this crate), so a crate-level dependency
// would be a cycle. The pure parser is copied here (byte-faithful to the TS) to
// break it; a reviewer decides the final home (likely a move of the parser into
// mainframe-git, since it is git-porcelain parsing).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorktreeEntry {
    path: String,
    branch: Option<String>,
}

fn parse_worktree_list(output: &str) -> Vec<WorktreeEntry> {
    let mut entries: Vec<WorktreeEntry> = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_branch: Option<String> = None;

    for line in output.split('\n') {
        if let Some(p) = line.strip_prefix("worktree ") {
            current_path = Some(p.to_string());
            current_branch = None;
        } else if let Some(b) = line.strip_prefix("branch ") {
            current_branch = Some(b.to_string());
        } else if line == "detached" {
            current_branch = None;
        } else if line.is_empty() && current_path.is_some() {
            entries.push(WorktreeEntry {
                path: current_path.take().unwrap_or_default(),
                branch: current_branch.take(),
            });
            current_path = None;
            current_branch = None;
        }
    }

    entries
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
mod mock_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    const PATH: &str = "/fake/path";

    type Call = (Vec<String>, Option<GitExecOptions>);
    type Handler = Box<dyn Fn(usize, &[String]) -> Result<String, GitExecError> + Send + Sync>;

    struct MockGitExec {
        handler: Handler,
        calls: Arc<Mutex<Vec<Call>>>,
    }

    impl MockGitExec {
        fn new(
            handler: impl Fn(usize, &[String]) -> Result<String, GitExecError> + Send + Sync + 'static,
        ) -> Self {
            Self {
                handler: Box::new(handler),
                calls: Arc::new(Mutex::new(Vec::new())),
            }
        }
    }

    impl GitExec for MockGitExec {
        fn exec(
            &self,
            args: Vec<String>,
            _cwd: String,
            opts: Option<GitExecOptions>,
        ) -> impl Future<Output = Result<String, GitExecError>> + Send {
            let idx = {
                let mut c = self.calls.lock().unwrap();
                c.push((args.clone(), opts.clone()));
                c.len() - 1
            };
            let result = (self.handler)(idx, &args);
            async move { result }
        }
    }

    fn gerr(message: &str) -> GitExecError {
        GitExecError {
            message: message.to_string(),
            code: None,
            stdout: None,
            stderr: None,
        }
    }

    fn service(
        handler: impl Fn(usize, &[String]) -> Result<String, GitExecError> + Send + Sync + 'static,
    ) -> (GitService<MockGitExec>, Arc<Mutex<Vec<Call>>>) {
        let mock = MockGitExec::new(handler);
        let calls = mock.calls.clone();
        (GitService::with_exec(PATH.to_string(), mock), calls)
    }

    fn owned(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn no_timeout() -> Option<GitExecOptions> {
        Some(GitExecOptions { timeout: Some(0) })
    }

    // ---- branches() ----

    #[tokio::test]
    async fn branches_returns_structured_branch_list() {
        let (svc, _calls) = service(|_i, args| {
            if args[0] == "branch" {
                Ok(
                    "* main\n  feat/foo\n  remotes/origin/main\n  remotes/origin/feat/foo\n"
                        .to_string(),
                )
            } else if args[0] == "worktree" {
                Ok(String::new())
            } else {
                Ok("origin/main\n".to_string())
            }
        });
        let result = svc.branches().await.unwrap();
        assert_eq!(result.current, "main");
        assert_eq!(result.local.len(), 2);
        assert!(result.remote.contains(&"origin/main".to_string()));
        assert_eq!(result.worktrees, Vec::<String>::new());
    }

    #[tokio::test]
    async fn branches_filters_out_remote_head_pseudo_refs() {
        let (svc, _calls) = service(|_i, args| {
            if args[0] == "branch" {
                Ok("* main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n  remotes/origin/feat/bar\n".to_string())
            } else if args[0] == "worktree" {
                Ok(String::new())
            } else {
                Ok("origin/main\n".to_string())
            }
        });
        let result = svc.branches().await.unwrap();
        assert_eq!(
            result.remote,
            vec!["origin/main".to_string(), "origin/feat/bar".to_string()]
        );
        assert!(!result.remote.iter().any(|r| r.contains("HEAD")));
    }

    #[tokio::test]
    async fn branches_tags_branches_with_worktree_dir_name() {
        let worktree_list = [
            "worktree /project",
            "HEAD aaa",
            "branch refs/heads/main",
            "",
            "worktree /project/.worktrees/my-feature",
            "HEAD bbb",
            "branch refs/heads/session/abc123",
            "",
        ]
        .join("\n");
        let (svc, _calls) = service(move |_i, args| {
            if args[0] == "branch" {
                Ok("* main\n  session/abc123\n".to_string())
            } else if args[0] == "worktree" {
                Ok(worktree_list.clone())
            } else {
                Ok("origin/main\n".to_string())
            }
        });
        let result = svc.branches().await.unwrap();
        assert_eq!(result.worktrees, vec!["my-feature".to_string()]);
        let wt_branch = result.local.iter().find(|b| b.name == "session/abc123");
        assert_eq!(
            wt_branch.and_then(|b| b.worktree.clone()),
            Some("my-feature".to_string())
        );
        let main_branch = result.local.iter().find(|b| b.name == "main");
        assert_eq!(main_branch.and_then(|b| b.worktree.clone()), None);
    }

    // ---- currentBranch() ----

    #[tokio::test]
    async fn current_branch_returns_name() {
        let (svc, _calls) = service(|_i, args| {
            Ok(if args[0] == "branch" {
                "* feat/test\n".to_string()
            } else {
                String::new()
            })
        });
        assert_eq!(svc.current_branch().await.unwrap(), "feat/test");
    }

    // ---- checkout() ----

    #[tokio::test]
    async fn checkout_local_branch() {
        let (svc, calls) = service(|_i, _args| Ok(String::new()));
        svc.checkout("main").await.unwrap();
        let calls = calls.lock().unwrap();
        assert!(
            calls
                .iter()
                .any(|(a, o)| *a == owned(&["checkout", "main"]) && o.is_none())
        );
    }

    #[tokio::test]
    async fn checkout_creates_tracking_branch_for_remote_ref() {
        let (svc, calls) = service(|_i, args| {
            Ok(if args[0] == "remote" {
                "origin\n".to_string()
            } else {
                String::new()
            })
        });
        svc.checkout("origin/feat/bar").await.unwrap();
        let calls = calls.lock().unwrap();
        assert!(calls.iter().any(|(a, o)| *a
            == owned(&["checkout", "-b", "feat/bar", "origin/feat/bar", "--track"])
            && o.is_none()));
    }

    #[tokio::test]
    async fn checkout_no_tracking_for_non_remote_slash_branch() {
        let (svc, calls) = service(|_i, args| {
            Ok(if args[0] == "remote" {
                "origin\n".to_string()
            } else {
                String::new()
            })
        });
        svc.checkout("feat/foo").await.unwrap();
        let calls = calls.lock().unwrap();
        assert!(
            calls
                .iter()
                .any(|(a, o)| *a == owned(&["checkout", "feat/foo"]) && o.is_none())
        );
    }

    #[tokio::test]
    async fn checkout_falls_back_to_plain_checkout_when_local_exists() {
        let (svc, calls) = service(|_i, args| {
            if args[0] == "remote" {
                Ok("origin\n".to_string())
            } else if args.get(1).map(String::as_str) == Some("-b") {
                Err(gerr("A branch named 'feat/bar' already exists"))
            } else {
                Ok(String::new())
            }
        });
        svc.checkout("origin/feat/bar").await.unwrap();
        let calls = calls.lock().unwrap();
        assert!(calls.iter().any(|(a, o)| *a
            == owned(&["checkout", "-b", "feat/bar", "origin/feat/bar", "--track"])
            && o.is_none()));
        assert!(
            calls
                .iter()
                .any(|(a, o)| *a == owned(&["checkout", "feat/bar"]) && o.is_none())
        );
    }

    #[tokio::test]
    async fn checkout_rethrows_non_exists_errors_for_remote_ref() {
        let (svc, calls) = service(|_i, args| {
            if args[0] == "remote" {
                Ok("origin\n".to_string())
            } else if args.get(1).map(String::as_str) == Some("-b") {
                Err(gerr("fatal: invalid reference: origin/bad-ref"))
            } else {
                Ok(String::new())
            }
        });
        let err = svc.checkout("origin/bad-ref").await.unwrap_err();
        assert!(err.to_string().contains("invalid reference"));
        let calls = calls.lock().unwrap();
        let checkout_calls = calls.iter().filter(|(a, _)| a[0] == "checkout").count();
        assert_eq!(checkout_calls, 1);
    }

    // ---- merge() ----

    #[tokio::test]
    async fn merge_success_on_clean_merge() {
        let (svc, _calls) = service(|_i, _args| {
            Ok("Merge made by the 'ort' strategy.\n 3 files changed, 10 insertions(+), 2 deletions(-)\n".to_string())
        });
        let result = svc.merge("feat/foo").await.unwrap();
        assert!(matches!(result, MergeResult::Success { .. }));
    }

    #[tokio::test]
    async fn merge_conflict_on_failure() {
        let (svc, _calls) = service(|_i, args| {
            if args[0] == "merge" {
                Err(gerr("CONFLICTS"))
            } else if args[0] == "diff" {
                Ok("src/index.ts\nsrc/app.ts\n".to_string())
            } else {
                Ok(String::new())
            }
        });
        let result = svc.merge("feat/foo").await.unwrap();
        match result {
            MergeResult::Conflict { conflicts, .. } => {
                assert!(conflicts.contains(&"src/index.ts".to_string()));
            }
            _ => panic!("expected conflict"),
        }
    }

    // ---- push() ----

    #[tokio::test]
    async fn push_success_with_matching_branch() {
        let (svc, calls) = service(|_i, args| {
            if args[0] == "branch" {
                Ok("* main\n".to_string())
            } else if args[0] == "rev-parse" {
                Ok("origin/main\n".to_string())
            } else {
                Ok(String::new())
            }
        });
        let result = svc.push(None, None).await.unwrap();
        assert!(matches!(result, PushResult::Success { .. }));
        let calls = calls.lock().unwrap();
        assert!(
            calls
                .iter()
                .any(|(a, o)| *a == owned(&["push", "origin", "main:main"]) && *o == no_timeout())
        );
    }

    #[tokio::test]
    async fn push_uses_refspec_when_remote_branch_differs() {
        let (svc, calls) = service(|_i, args| {
            Ok(if args[0] == "rev-parse" {
                "origin/session/imhoQVRy\n".to_string()
            } else {
                String::new()
            })
        });
        let result = svc.push(Some("session/imhoQVRy-2"), None).await.unwrap();
        assert!(matches!(result, PushResult::Success { .. }));
        let calls = calls.lock().unwrap();
        assert!(calls.iter().any(|(a, o)| *a
            == owned(&["push", "origin", "session/imhoQVRy-2:session/imhoQVRy"])
            && *o == no_timeout()));
    }

    #[tokio::test]
    async fn push_falls_back_to_local_name_without_upstream() {
        let (svc, calls) = service(|_i, args| {
            if args[0] == "branch" {
                Ok("* new-branch\n".to_string())
            } else if args[0] == "rev-parse" {
                Err(gerr("no upstream"))
            } else {
                Ok(String::new())
            }
        });
        let result = svc.push(None, None).await.unwrap();
        assert!(matches!(result, PushResult::Success { .. }));
        let calls = calls.lock().unwrap();
        assert!(calls.iter().any(|(a, o)| *a
            == owned(&["push", "origin", "new-branch:new-branch"])
            && *o == no_timeout()));
    }

    // ---- pull() ----

    #[tokio::test]
    async fn pull_uses_fetch_refspec_for_non_current_branch() {
        let rev = AtomicUsize::new(0);
        let (svc, calls) = service(move |_i, args| {
            if args[0] == "branch" {
                Ok("* main\n".to_string())
            } else if args[0] == "rev-parse" {
                Ok(if rev.fetch_add(1, Ordering::SeqCst) == 0 {
                    "aaa\n".to_string()
                } else {
                    "bbb\n".to_string()
                })
            } else {
                Ok(String::new())
            }
        });
        let result = svc
            .pull(Some("origin"), Some("feat/foo"), Some("feat/foo"))
            .await
            .unwrap();
        let calls = calls.lock().unwrap();
        assert!(calls.iter().any(
            |(a, o)| *a == owned(&["fetch", "origin", "feat/foo:feat/foo"]) && *o == no_timeout()
        ));
        assert!(matches!(result, PullResult::Success { .. }));
    }

    #[tokio::test]
    async fn pull_up_to_date_when_non_current_ref_unchanged() {
        let (svc, _calls) = service(|_i, args| {
            if args[0] == "branch" {
                Ok("* main\n".to_string())
            } else if args[0] == "rev-parse" {
                Ok("aaa\n".to_string())
            } else {
                Ok(String::new())
            }
        });
        let result = svc
            .pull(Some("origin"), Some("feat/foo"), Some("feat/foo"))
            .await
            .unwrap();
        assert!(matches!(result, PullResult::UpToDate));
    }

    // ---- deleteBranch() ----

    #[tokio::test]
    async fn delete_branch_returns_success() {
        let (svc, _calls) =
            service(|_i, _args| Ok("Deleted branch feat/old (was abc123).\n".to_string()));
        let result = svc.delete_branch("feat/old", false, false).await.unwrap();
        assert!(matches!(result, DeleteBranchResult::Success));
    }

    // ---- abort() ----

    #[tokio::test]
    async fn abort_returns_false_when_no_merge_or_rebase() {
        let (svc, _calls) = service(|_i, _args| Ok("/fake/path/.git\n".to_string()));
        let result = svc.abort().await.unwrap();
        assert_eq!(result, AbortResult { aborted: false });
    }

    // ---- detectBaseBranch() ----

    #[tokio::test]
    async fn detect_base_branch_returns_main_when_merge_base_exists() {
        let (svc, calls) = service(|idx, _args| {
            if idx == 0 {
                Ok("abc123\n".to_string())
            } else {
                Ok(String::new())
            }
        });
        let result = svc.detect_base_branch().await.unwrap();
        assert_eq!(
            result,
            Some(DetectedBaseBranch {
                base_branch: "main".to_string(),
                merge_base: "abc123".to_string()
            })
        );
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert!(
            calls
                .iter()
                .any(|(a, o)| *a == owned(&["merge-base", "main", "HEAD"]) && o.is_none())
        );
    }

    #[tokio::test]
    async fn detect_base_branch_falls_back_to_master() {
        let (svc, calls) = service(|idx, _args| {
            if idx == 0 {
                Err(gerr("no common ancestor"))
            } else {
                Ok("def456\n".to_string())
            }
        });
        let result = svc.detect_base_branch().await.unwrap();
        assert_eq!(
            result,
            Some(DetectedBaseBranch {
                base_branch: "master".to_string(),
                merge_base: "def456".to_string()
            })
        );
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].0, owned(&["merge-base", "main", "HEAD"]));
        assert_eq!(calls[1].0, owned(&["merge-base", "master", "HEAD"]));
    }

    #[tokio::test]
    async fn detect_base_branch_returns_null_when_neither_resolves() {
        let (svc, _calls) = service(|_idx, _args| Err(gerr("no common ancestor")));
        let result = svc.detect_base_branch().await.unwrap();
        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn detect_base_branch_prefers_main() {
        let (svc, calls) = service(|idx, _args| {
            if idx == 0 {
                Ok("sha999\n".to_string())
            } else {
                Ok("sha111\n".to_string())
            }
        });
        let result = svc.detect_base_branch().await.unwrap();
        assert_eq!(
            result,
            Some(DetectedBaseBranch {
                base_branch: "main".to_string(),
                merge_base: "sha999".to_string()
            })
        );
        assert_eq!(calls.lock().unwrap().len(), 1);
    }
}

// Real-git temp-repo integration tests (ported from
// `src/git/__tests__/git-service-review.test.ts`).
#[cfg(test)]
mod review_tests {
    use super::*;
    use tokio::process::Command;

    async fn git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .await
            .unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    async fn init_repo(dir: &Path) {
        git(dir, &["init"]).await;
        git(dir, &["config", "user.email", "test@test.com"]).await;
        git(dir, &["config", "user.name", "Test"]).await;
        // Hermetic against the developer's global git config: signing (if enabled
        // globally) shells out to gpg, which fails non-deterministically under the
        // parallel test load. Repo-local override applies to GitService's commits
        // too (they inherit repo config).
        git(dir, &["config", "commit.gpgsign", "false"]).await;
        tokio::fs::write(dir.join("README.md"), "# Test\n")
            .await
            .unwrap();
        git(dir, &["add", "README.md"]).await;
        git(dir, &["commit", "-m", "init"]).await;
    }

    // ---- commitAll ----

    #[tokio::test]
    async fn commit_all_stages_all_and_returns_sha() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir).await;
        let svc = GitService::for_project(dir.to_string_lossy().into_owned());

        tokio::fs::write(dir.join("new-file.ts"), "export const x = 1;\n")
            .await
            .unwrap();
        tokio::fs::write(dir.join("README.md"), "# Updated\n")
            .await
            .unwrap();

        let sha = svc.commit_all("feat: add new file").await.unwrap();
        assert!(!sha.is_empty());
        assert_eq!(sha.len(), 40);
        assert!(sha.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[tokio::test]
    async fn commit_all_includes_untracked_files() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir).await;
        let svc = GitService::for_project(dir.to_string_lossy().into_owned());

        tokio::fs::write(dir.join("untracked.ts"), "const y = 2;\n")
            .await
            .unwrap();
        svc.commit_all("feat: commit untracked").await.unwrap();

        let log = git(dir, &["show", "--name-only", "--format=", "HEAD"]).await;
        assert!(log.contains("untracked.ts"));
    }

    #[tokio::test]
    async fn commit_all_includes_deleted_files() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir).await;
        let svc = GitService::for_project(dir.to_string_lossy().into_owned());

        tokio::fs::write(dir.join("to-delete.ts"), "const z = 3;\n")
            .await
            .unwrap();
        git(dir, &["add", "to-delete.ts"]).await;
        git(dir, &["commit", "-m", "add to-delete"]).await;

        tokio::fs::remove_file(dir.join("to-delete.ts"))
            .await
            .unwrap();
        svc.commit_all("chore: remove to-delete").await.unwrap();

        let log = git(dir, &["show", "--name-status", "--format=", "HEAD"]).await;
        assert!(log.contains('D') && log.contains("to-delete.ts"));
    }

    #[tokio::test]
    async fn commit_all_throws_when_nothing_to_commit() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir).await;
        let svc = GitService::for_project(dir.to_string_lossy().into_owned());
        assert!(svc.commit_all("empty commit").await.is_err());
    }

    // ---- workingStat ----

    #[tokio::test]
    async fn working_stat_empty_when_clean() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir).await;
        let svc = GitService::for_project(dir.to_string_lossy().into_owned());
        let result = svc.working_stat().await.unwrap();
        assert_eq!(result.files, Vec::<WorkingStatFile>::new());
        assert_eq!(result.total_additions, 0);
        assert_eq!(result.total_deletions, 0);
    }

    #[tokio::test]
    async fn working_stat_counts_modified_tracked() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir).await;
        let svc = GitService::for_project(dir.to_string_lossy().into_owned());

        tokio::fs::write(dir.join("README.md"), "# Updated\nline2\nline3\n")
            .await
            .unwrap();
        let result = svc.working_stat().await.unwrap();
        let entry = result.files.iter().find(|f| f.path == "README.md").unwrap();
        assert!(entry.additions > 0);
        assert!(result.total_additions > 0);
    }

    #[tokio::test]
    async fn working_stat_counts_new_untracked() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir).await;
        let svc = GitService::for_project(dir.to_string_lossy().into_owned());

        tokio::fs::write(dir.join("new-file.ts"), "const a = 1;\nconst b = 2;\n")
            .await
            .unwrap();
        let result = svc.working_stat().await.unwrap();
        let entry = result
            .files
            .iter()
            .find(|f| f.path == "new-file.ts")
            .unwrap();
        assert_eq!(entry.additions, 2);
        assert_eq!(entry.deletions, 0);
        assert!(result.total_additions >= 2);
    }

    #[tokio::test]
    async fn working_stat_counts_untracked_in_subdir() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir).await;
        let svc = GitService::for_project(dir.to_string_lossy().into_owned());

        tokio::fs::create_dir_all(dir.join("src")).await.unwrap();
        tokio::fs::write(dir.join("src").join("index.ts"), "export {};\n")
            .await
            .unwrap();
        let result = svc.working_stat().await.unwrap();
        let entry = result
            .files
            .iter()
            .find(|f| f.path == "src/index.ts")
            .unwrap();
        assert_eq!(entry.additions, 1);
    }

    #[tokio::test]
    async fn working_stat_counts_deletions() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir).await;
        let svc = GitService::for_project(dir.to_string_lossy().into_owned());

        tokio::fs::write(dir.join("README.md"), "").await.unwrap();
        let result = svc.working_stat().await.unwrap();
        let entry = result.files.iter().find(|f| f.path == "README.md").unwrap();
        assert!(entry.deletions >= 1);
        assert!(result.total_deletions >= 1);
    }

    #[tokio::test]
    async fn working_stat_binary_files_zero() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir).await;
        let svc = GitService::for_project(dir.to_string_lossy().into_owned());

        tokio::fs::write(dir.join("data.bin"), [0x00u8, 0x01, 0x02, 0x03])
            .await
            .unwrap();
        let result = svc.working_stat().await.unwrap();
        let entry = result.files.iter().find(|f| f.path == "data.bin").unwrap();
        assert_eq!(entry.additions, 0);
        assert_eq!(entry.deletions, 0);
    }

    #[tokio::test]
    async fn working_stat_totals_across_files() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir).await;
        let svc = GitService::for_project(dir.to_string_lossy().into_owned());

        tokio::fs::write(dir.join("a.ts"), "const a = 1;\nconst b = 2;\n")
            .await
            .unwrap();
        tokio::fs::write(dir.join("b.ts"), "const c = 3;\n")
            .await
            .unwrap();
        let result = svc.working_stat().await.unwrap();
        let a_entry = result.files.iter().find(|f| f.path == "a.ts").unwrap();
        let b_entry = result.files.iter().find(|f| f.path == "b.ts").unwrap();
        assert_eq!(a_entry.additions, 2);
        assert_eq!(b_entry.additions, 1);
        assert!(result.total_additions >= 3);
        assert!(result.files.len() >= 2);
    }
}

// PORT STATUS: packages/core/src/git/git-service.ts (543 lines)
// confidence: high
// notes: Every public method keeps the TS name/arg-order/control-flow/error
// strings. DEVIATIONS (all recorded): (1) `withLock` is inlined as a scoped
// `let _guard = acquire_project_lock(...)` (guard drop == the TS `finally
// release()`), avoiding async-closure-borrows-self lifetime issues; behavior
// identical. (2) An injectable `GitExec` trait + `RealGitExec` is a Rust-port
// testability seam (no TS counterpart) so the argv-dispatch mock suite ports
// assertion-for-assertion; production is `GitService<RealGitExec>` via
// `for_project`. (3) `parse_worktree_list`/`WorktreeEntry` are copied locally
// from `workspace/worktree.ts` to break a crate cycle (that module also depends
// on exec_git) — a reviewer picks the final home. (4) `detectBaseBranch`/`abort`
// inline result objects become local `DetectedBaseBranch`/`AbortResult` structs
// (no named TS type). rebase()'s inner catch re-throws the ORIGINAL exec error
// (not a status() error), matching TS. git-dir MERGE_HEAD/rebase-* probes use the
// path as-returned by `git rev-parse --git-dir` (relative to process cwd, as in
// TS). Both test suites ported: 20 argv-dispatch mock tests + 11 real-git
// temp-repo tests.
