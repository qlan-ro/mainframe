//! Parsers for the summaries git prints after commit, merge, pull, and
//! `diff --numstat`.

use mainframe_types::git::WorkingStatFile;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffStatSummary {
    pub changes: i64,
    pub insertions: i64,
    pub deletions: i64,
}

/// Extracts the commit hash from `git commit` output, whose first line is
/// `[<branch> (root-commit)? <hash>] <subject>`. Returns an empty string when
/// no such line exists. Run commit with `-c core.abbrev=40` to get the full sha.
pub fn parse_commit_hash(output: &str) -> String {
    output
        .lines()
        .find_map(match_commit_line)
        .unwrap_or_default()
}

/// Matches `[<branch>[ (<note>)] <hash>]` at the start of a line.
fn match_commit_line(line: &str) -> Option<String> {
    let s = line.strip_prefix('[')?;
    let branch_end = s.find(char::is_whitespace)?;
    if branch_end == 0 {
        return None;
    }
    let mut rest = &s[branch_end..];
    if let Some(after_note) = strip_parenthesized_note(rest) {
        rest = after_note;
    }
    let rest = rest.strip_prefix(' ')?;
    let close = rest.find(']')?;
    if close == 0 {
        return None;
    }
    Some(rest[..close].trim().to_string())
}

/// Strips a leading ` (<note>)`, such as ` (root-commit)`.
fn strip_parenthesized_note(rest: &str) -> Option<&str> {
    let r = rest.strip_prefix(" (")?;
    let close = r.find(')')?;
    if close == 0 {
        return None;
    }
    Some(&r[close + 1..])
}

/// Parses the diffstat summary line git prints for pull/merge, e.g.
/// `3 files changed, 10 insertions(+), 2 deletions(-)`. Missing insertion or
/// deletion clauses count as 0. `changes` is the "N files changed" count.
pub fn parse_diff_stat_summary(output: &str) -> DiffStatSummary {
    output.lines().find_map(match_diff_stat).unwrap_or_default()
}

/// Finds `N file(s) changed[, N insertion(s)(+)][, N deletion(s)(-)]` anywhere
/// in the line.
fn match_diff_stat(line: &str) -> Option<DiffStatSummary> {
    line.char_indices()
        .filter(|(_, c)| c.is_ascii_digit())
        .find_map(|(start, _)| diff_stat_at(&line[start..]))
}

fn diff_stat_at(rest: &str) -> Option<DiffStatSummary> {
    let (changes, rest) = take_digits(rest)?;
    let rest = rest.strip_prefix(" file")?;
    let rest = rest.strip_prefix('s').unwrap_or(rest);
    let mut rest = rest.strip_prefix(" changed")?;

    let mut summary = DiffStatSummary {
        changes,
        ..DiffStatSummary::default()
    };
    if let Some((n, r)) = stat_clause(rest, "insertion", "(+)") {
        summary.insertions = n;
        rest = r;
    }
    if let Some((n, _)) = stat_clause(rest, "deletion", "(-)") {
        summary.deletions = n;
    }
    Some(summary)
}

/// Matches `, N <word>[s]<suffix>`.
fn stat_clause<'a>(s: &'a str, word: &str, suffix: &str) -> Option<(i64, &'a str)> {
    let r = s.strip_prefix(", ")?;
    let (n, r) = take_digits(r)?;
    let r = r.strip_prefix(' ')?.strip_prefix(word)?;
    let r = r.strip_prefix('s').unwrap_or(r);
    Some((n, r.strip_prefix(suffix)?))
}

/// Splits off one or more leading ASCII digits. A count too large for `i64`
/// reads as 0.
fn take_digits(s: &str) -> Option<(i64, &str)> {
    let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    if end == 0 {
        return None;
    }
    Some((s[..end].parse().unwrap_or(0), &s[end..]))
}

/// Count of `Auto-merging <file>` lines git prints during a merge.
pub fn count_auto_merges(output: &str) -> usize {
    output
        .lines()
        .filter(|l| l.starts_with("Auto-merging "))
        .count()
}

/// Parses `git diff --numstat -z` records: `add\tdel\tpath\0`, or for a rename
/// `add\tdel\t\0old\0new\0`, reported under the new path. Paths are verbatim
/// (no C-quoting). Binary files print `-` counts, which read as 0.
pub(crate) fn parse_numstat_z(numstat: &str) -> Vec<WorkingStatFile> {
    let count = |s: &str| s.parse().unwrap_or(0);
    let mut files = Vec::new();
    let mut tokens = numstat.split('\0');
    while let Some(record) = tokens.next() {
        let mut parts = record.splitn(3, '\t');
        let (Some(additions), Some(deletions), Some(path)) =
            (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let path = if path.is_empty() {
            tokens.next();
            tokens.next().unwrap_or("")
        } else {
            path
        };
        if path.is_empty() {
            continue;
        }
        files.push(WorkingStatFile {
            path: path.to_string(),
            additions: count(additions),
            deletions: count(deletions),
        });
    }
    files
}

#[cfg(test)]
#[path = "summary_tests.rs"]
mod tests;
