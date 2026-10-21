//! Staging, committing, and working-tree change counts.

use std::path::Path;

use mainframe_types::git::{WorkingStat, WorkingStatFile};

use super::{GitExec, GitService, GitServiceError};
use crate::git_parse::{parse_commit_hash, parse_numstat_z, porcelain_z_entries};

impl<E: GitExec> GitService<E> {
    pub async fn stage(&self, files: &[String]) -> Result<(), GitServiceError> {
        let mut args = argv!["add", "--"];
        args.extend_from_slice(files);
        self.git(args).await?;
        Ok(())
    }

    pub async fn unstage(&self, files: &[String]) -> Result<(), GitServiceError> {
        if files.is_empty() {
            return Ok(());
        }
        let mut args = argv!["reset", "HEAD", "--"];
        args.extend_from_slice(files);
        self.git(args).await?;
        Ok(())
    }

    /// Commits the index and returns the full commit sha, or an empty string
    /// when git printed no commit line.
    pub async fn commit(&self, message: &str) -> Result<String, GitServiceError> {
        // `core.abbrev=40` makes git print the full sha in its summary line.
        let out = self
            .git(argv!["-c", "core.abbrev=40", "commit", "-m", message])
            .await?;
        Ok(parse_commit_hash(&out))
    }

    /// Stages every change (tracked edits, new files, and deletions) and
    /// commits. Fails with [`GitServiceError::NothingToCommit`] on a clean
    /// tree, where `git commit` itself would fail with an empty stderr.
    pub async fn commit_all(&self, message: &str) -> Result<String, GitServiceError> {
        self.git(argv!["add", "-A"]).await?;
        if self.git(argv!["status", "--porcelain"]).await?.is_empty() {
            return Err(GitServiceError::NothingToCommit);
        }
        self.commit(message).await
    }

    /// Per-file addition/deletion counts for the working tree (vs HEAD), plus
    /// totals. Tracked changes come from `git diff --numstat HEAD`; untracked
    /// files are line-counted directly. Binary files report 0/0.
    pub async fn working_stat(&self) -> Result<WorkingStat, GitServiceError> {
        let numstat = self.git(argv!["diff", "--numstat", "-z", "HEAD"]).await?;
        let mut files = parse_numstat_z(&numstat);

        let status = self
            .git(argv!["status", "--porcelain", "-z", "-uall"])
            .await?;
        for entry in porcelain_z_entries(&status) {
            if entry.index != '?' || entry.path.ends_with('/') {
                continue;
            }
            files.push(WorkingStatFile {
                path: entry.path.to_string(),
                additions: self.count_untracked_lines(entry.path).await,
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
    async fn count_untracked_lines(&self, rel_path: &str) -> i64 {
        match tokio::fs::read(Path::new(&self.project_path).join(rel_path)).await {
            Ok(buf) if !buf.contains(&0) => count_lines(&buf),
            Ok(_) => 0,
            // expected — the file may have vanished between status and read
            Err(_) => 0,
        }
    }
}

/// Newline-terminated lines, plus a final unterminated one.
fn count_lines(buf: &[u8]) -> i64 {
    let newlines = buf.iter().filter(|&&b| b == b'\n').count();
    let unterminated = usize::from(buf.last().is_some_and(|&b| b != b'\n'));
    i64::try_from(newlines + unterminated).unwrap_or(i64::MAX)
}

#[cfg(test)]
#[path = "commit_tests.rs"]
mod tests;
