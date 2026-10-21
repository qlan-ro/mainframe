//! `git branch` and `git for-each-ref refs/heads` parsers.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BranchList {
    pub current: String,
    pub all: Vec<String>,
}

/// Parses `git branch --no-color [-a]` output into the current branch and the
/// full list of branch names. Remote branches keep their `remotes/<remote>/...`
/// prefix; the `remotes/origin/HEAD -> origin/main` pointer keeps its name so
/// callers can filter it. Detached HEAD lines resolve to the ref they point at.
pub fn parse_branch_list(output: &str) -> BranchList {
    let mut all: Vec<String> = Vec::new();
    let mut current = String::new();
    for line in output.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let rest = strip_branch_marker(line);
        let name = match parse_detached(rest) {
            Some(sha) => sha.to_string(),
            None => rest.split_whitespace().next().unwrap_or("").to_string(),
        };
        if name.is_empty() {
            continue;
        }
        if line.starts_with("* ") {
            current.clone_from(&name);
        }
        all.push(name);
    }
    BranchList { current, all }
}

/// Strips the `* ` (current) or `+ ` (checked out in another worktree) marker
/// and the indentation after it. A marker without trailing whitespace is part
/// of the name, so the line is returned unchanged.
fn strip_branch_marker(line: &str) -> &str {
    let after_marker = line.strip_prefix(['*', '+']).unwrap_or(line);
    let name = after_marker.trim_start();
    if name.len() == after_marker.len() {
        line
    } else {
        name
    }
}

/// Resolves `(HEAD detached at <ref>)` or `(detached from <ref>)` to `<ref>`.
fn parse_detached(rest: &str) -> Option<&str> {
    let inner = rest.strip_prefix('(')?;
    let inner = inner.strip_prefix("HEAD ").unwrap_or(inner);
    let after = inner
        .strip_prefix("detached from ")
        .or_else(|| inner.strip_prefix("detached at "))?;
    let word = after.split(char::is_whitespace).next()?;
    word.strip_suffix(')').filter(|sha| !sha.is_empty())
}

/// The `git for-each-ref` format [`parse_branch_tracking`] reads: one line per
/// local branch, NUL-separated fields.
pub(crate) const TRACKING_FORMAT: &str = "--format=%(refname:lstrip=2)%00%(upstream:short)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:track,nobracket)";

/// A local branch's upstream and how far the two have diverged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BranchTracking {
    pub branch: String,
    /// The upstream's short name, e.g. `origin/main`.
    pub upstream: String,
    /// The upstream's remote, or `.` when it tracks another local branch.
    pub remote: String,
    /// The branch name on the remote, without `refs/heads/`.
    pub remote_branch: String,
    pub ahead: i64,
    pub behind: i64,
}

impl BranchTracking {
    /// Whether the upstream is another local branch rather than a remote's.
    pub fn tracks_local_branch(&self) -> bool {
        self.remote == "."
    }
}

/// Parses `git for-each-ref refs/heads` output in [`TRACKING_FORMAT`] into one
/// entry per branch with a live upstream. Branches without an upstream, or
/// whose upstream ref no longer exists (`gone`), are omitted.
pub(crate) fn parse_branch_tracking(output: &str) -> Vec<BranchTracking> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\0');
            let branch = fields.next()?;
            let upstream = fields.next()?;
            let remote = fields.next()?;
            let remote_ref = fields.next()?;
            let track = fields.next()?;
            if branch.is_empty() || upstream.is_empty() || track == "gone" {
                return None;
            }
            let (ahead, behind) = parse_track(track);
            Some(BranchTracking {
                branch: branch.to_string(),
                upstream: upstream.to_string(),
                remote: remote.to_string(),
                remote_branch: remote_ref
                    .strip_prefix("refs/heads/")
                    .unwrap_or(remote_ref)
                    .to_string(),
                ahead,
                behind,
            })
        })
        .collect()
}

/// Reads `ahead N, behind M` (either clause optional, empty when in sync).
fn parse_track(track: &str) -> (i64, i64) {
    let mut ahead = 0;
    let mut behind = 0;
    for clause in track.split(", ") {
        if let Some(n) = clause.strip_prefix("ahead ") {
            ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = clause.strip_prefix("behind ") {
            behind = n.parse().unwrap_or(0);
        }
    }
    (ahead, behind)
}

#[cfg(test)]
#[path = "branch_tests.rs"]
mod tests;
