//! `GitService`: the git operations the daemon exposes, built on `exec_git`
//! and the `git_parse` parsers. Mutating operations hold the per-project lock.
//!
//! Every user-supplied ref or name follows `--end-of-options`, so a value such
//! as `--upload-pack=<cmd>` reaches git as a ref, never as an option.

use std::future::Future;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::git_exec::{GitExecError, GitTimeout, exec_git};
use crate::git_parse::{BranchList, RemoteUrl, parse_branch_list, parse_remote_urls};

/// Builds a `Vec<String>` git argv from string-like values.
macro_rules! argv {
    ($($x:expr),* $(,)?) => { vec![$($x.to_string()),*] };
}

mod branches;
mod commit;
mod operation;
mod revs;
mod sync;
mod update;

#[cfg(test)]
mod test_support;

/// Separates git options from the user-supplied refs that follow.
const END_OF_OPTIONS: &str = "--end-of-options";

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

/// Errors from `GitService` methods. The `Display` text reaches API clients.
#[derive(Debug, thiserror::Error)]
pub enum GitServiceError {
    #[error(transparent)]
    Exec(#[from] GitExecError),
    #[error("Nothing to commit")]
    NothingToCommit,
    #[error("Invalid remote branch name: {0}")]
    InvalidRemoteBranch(String),
}

/// The single subprocess seam. Production uses [`RealGitExec`] (→ [`exec_git`]);
/// tests inject a recording fake to assert the exact git argv.
pub trait GitExec: Send + Sync {
    fn exec(
        &self,
        args: &[String],
        cwd: &str,
        timeout: GitTimeout,
    ) -> impl Future<Output = Result<String, GitExecError>> + Send;
}

/// The production executor: shells out via [`exec_git`].
#[derive(Debug, Clone, Copy, Default)]
pub struct RealGitExec;

impl GitExec for RealGitExec {
    async fn exec(
        &self,
        args: &[String],
        cwd: &str,
        timeout: GitTimeout,
    ) -> Result<String, GitExecError> {
        exec_git(args, cwd, timeout).await
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
    #[cfg(test)]
    fn with_exec(project_path: String, exec: E) -> Self {
        Self { project_path, exec }
    }

    async fn git(&self, args: Vec<String>) -> Result<String, GitExecError> {
        self.exec
            .exec(&args, &self.project_path, GitTimeout::Default)
            .await
    }

    /// Runs a network operation, which may outlast the default timeout.
    async fn git_unbounded(&self, args: Vec<String>) -> Result<String, GitExecError> {
        self.exec
            .exec(&args, &self.project_path, GitTimeout::Unbounded)
            .await
    }

    /// The repository's git directory as an absolute path. Plain `--git-dir`
    /// prints `.git` relative to the project, which would resolve against the
    /// daemon's own working directory.
    async fn git_dir(&self) -> Result<PathBuf, GitExecError> {
        let out = self.git(argv!["rev-parse", "--absolute-git-dir"]).await?;
        Ok(PathBuf::from(out.trim()))
    }

    async fn branch_info(&self, all: bool) -> Result<BranchList, GitExecError> {
        let mut args = argv!["branch", "--no-color"];
        if all {
            args.push("-a".to_string());
        }
        Ok(parse_branch_list(&self.git(args).await?))
    }

    pub async fn current_branch(&self) -> Result<String, GitServiceError> {
        Ok(self.branch_info(false).await?.current)
    }

    /// Raw `git status --porcelain -z` output, for the `git_parse` status parsers.
    /// `-uall` lists each file inside a new directory; without it git reports
    /// the bare `dir/`, which the status parsers drop as a directory entry.
    pub async fn status_raw(&self) -> Result<String, GitServiceError> {
        Ok(self
            .git(argv!["status", "--porcelain", "-z", "-uall"])
            .await?)
    }

    /// `git diff <args>`. The caller owns `args`, options included, so it must
    /// keep untrusted values out of option position.
    pub async fn diff(&self, args: &[String]) -> Result<String, GitServiceError> {
        let mut a = argv!["diff"];
        a.extend_from_slice(args);
        Ok(self.git(a).await?)
    }

    pub async fn show(&self, git_ref: &str) -> Result<String, GitServiceError> {
        Ok(self.git(argv!["show", END_OF_OPTIONS, git_ref]).await?)
    }

    /// Every remote's name and URL, deduped across the fetch/push pair `git
    /// remote -v` prints for each. No filtering — callers derive `owner/repo`
    /// (e.g. `github_repo_from_url`) themselves.
    pub async fn remotes_with_urls(&self) -> Result<Vec<RemoteUrl>, GitServiceError> {
        Ok(parse_remote_urls(&self.git(argv!["remote", "-v"]).await?))
    }
}
