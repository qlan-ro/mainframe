//! `git status --porcelain -z` parsers.

use serde::{Deserialize, Serialize};

use super::DiffEntry;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatusBuckets {
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
    pub untracked: Vec<String>,
}

/// One entry of `git status --porcelain -z` output. The NUL-separated format
/// emits paths verbatim; the newline format C-quotes any path containing a
/// space, so every status parser here consumes `-z`.
pub(crate) struct PorcelainEntry<'a> {
    pub index: char,
    pub working: char,
    pub path: &'a str,
    /// Source path of a renamed (R) or copied (C) entry.
    pub old_path: Option<&'a str>,
}

/// Splits `git status --porcelain -z` output into entries. A renamed or copied
/// entry is `XY new\0old\0`, so it consumes the following token as its source.
pub(crate) fn porcelain_z_entries(output: &str) -> Vec<PorcelainEntry<'_>> {
    let mut entries = Vec::new();
    let mut tokens = output.split('\0');
    while let Some(entry) = tokens.next() {
        if entry.len() < 3 || !entry.is_char_boundary(2) {
            continue;
        }
        let mut code = entry[..2].chars();
        let index = code.next().unwrap_or(' ');
        let working = code.next().unwrap_or(' ');
        let old_path = if index == 'R' || index == 'C' {
            tokens.next()
        } else {
            None
        };
        entries.push(PorcelainEntry {
            index,
            working,
            path: &entry[3..],
            old_path,
        });
    }
    entries
}

/// Parses `git status --porcelain -z` output into structured file entries.
/// Renamed (R) and copied (C) entries carry an `old_path`. Directory entries
/// (trailing slash) are filtered.
pub fn parse_status_lines(output: &str) -> Vec<DiffEntry> {
    porcelain_z_entries(output)
        .into_iter()
        .filter(|e| !e.path.ends_with('/'))
        .map(|e| DiffEntry {
            status: format!("{}{}", e.index, e.working).trim().to_string(),
            path: e.path.to_string(),
            old_path: e.old_path.map(String::from),
        })
        .collect()
}

/// Parses `git status --porcelain -z` output into staged/unstaged/untracked
/// buckets. Uses the two-character XY format: X = index status, Y = working-tree
/// status.
pub fn parse_status_buckets(output: &str) -> StatusBuckets {
    let mut staged: Vec<String> = Vec::new();
    let mut unstaged: Vec<String> = Vec::new();
    let mut untracked: Vec<String> = Vec::new();

    for e in porcelain_z_entries(output) {
        if e.index == '?' && e.working == '?' {
            untracked.push(e.path.to_string());
            continue;
        }
        if e.index != ' ' {
            staged.push(e.path.to_string());
        }
        if e.working != ' ' {
            unstaged.push(e.path.to_string());
        }
    }

    StatusBuckets {
        staged,
        unstaged,
        untracked,
    }
}

#[cfg(test)]
#[path = "status_tests.rs"]
mod tests;
