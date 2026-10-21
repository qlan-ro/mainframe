//! `git worktree list --porcelain` parser.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorktreeEntry {
    pub path: String,
    /// The full ref (`refs/heads/<name>`); `None` for a detached worktree.
    pub branch: Option<String>,
}

/// Parses `git worktree list --porcelain` records, including detached worktrees.
pub fn parse_worktree_list(output: &str) -> Vec<WorktreeEntry> {
    let mut entries = Vec::new();
    let mut path: Option<String> = None;
    let mut branch: Option<String> = None;
    for line in output.split('\n') {
        if let Some(value) = line.strip_prefix("worktree ") {
            path = Some(value.to_string());
            branch = None;
        } else if let Some(value) = line.strip_prefix("branch ") {
            branch = Some(value.to_string());
        } else if line == "detached" {
            branch = None;
        } else if line.is_empty()
            && let Some(path) = path.take()
        {
            entries.push(WorktreeEntry {
                path,
                branch: branch.take(),
            });
        }
    }
    entries
}

#[cfg(test)]
#[path = "worktree_tests.rs"]
mod tests;
