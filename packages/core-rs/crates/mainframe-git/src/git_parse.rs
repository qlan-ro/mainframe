//! Shared git output parsers used by route handlers and GitService. These are
//! the porcelain spec — the tests below pin each fixture string exactly.

use serde::{Deserialize, Serialize};

use crate::git_exec::GitExecError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffEntry {
    pub status: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatusBuckets {
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
    pub untracked: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BranchList {
    pub current: String,
    pub all: Vec<String>,
}

// `working_dir` is intentionally snake_case (simple-git's `FileStatusResult`
// field name) — no camelCase rename.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatusFile {
    pub path: String,
    pub index: String,
    pub working_dir: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PorcelainStatus {
    pub conflicted: Vec<String>,
    pub files: Vec<StatusFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffStatSummary {
    pub changes: i64,
    pub insertions: i64,
    pub deletions: i64,
}

/// Returns true when an error originates from running git in a non-repo
/// directory. Used to suppress noisy warnings for expected "not a git
/// repository" failures.
///
/// Takes a typed `&GitExecError`, so non-error values cannot reach it.
pub fn is_not_git_repo(err: &GitExecError) -> bool {
    err.message.contains("not a git repository")
}

/// Parses `git diff --name-status` output (tab-separated) into structured
/// entries. Renamed (R) and copied (C) entries carry an `old_path`.
pub fn parse_diff_name_status(output: &str) -> Vec<DiffEntry> {
    output
        .split('\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            let status = parts.first().copied().unwrap_or("");
            if status.starts_with('R') || status.starts_with('C') {
                DiffEntry {
                    status: status.chars().next().map(String::from).unwrap_or_default(),
                    path: parts.get(2).copied().unwrap_or("").to_string(),
                    old_path: parts.get(1).map(|s| s.to_string()),
                }
            } else {
                DiffEntry {
                    status: status.to_string(),
                    path: parts.get(1).copied().unwrap_or("").to_string(),
                    old_path: None,
                }
            }
        })
        .filter(|f| !f.path.is_empty())
        .collect()
}

/// Parses `git status --porcelain` output into structured file entries.
/// Each line's first two characters are the XY status code; the rest (after 3
/// chars) is the path. Renamed (R) and copied (C) entries use " -> " to
/// separate old and new paths. Directory entries (trailing slash) are filtered.
pub fn parse_status_lines(output: &str) -> Vec<DiffEntry> {
    output
        .split('\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let code = line.chars().take(2).collect::<String>().trim().to_string();
            let rest: String = line.chars().skip(3).collect();
            if (code.starts_with('R') || code.starts_with('C'))
                && let Some(arrow) = rest.find(" -> ")
            {
                return DiffEntry {
                    status: code,
                    path: rest[arrow + 4..].to_string(),
                    old_path: Some(rest[..arrow].to_string()),
                };
            }
            DiffEntry {
                status: code,
                path: rest,
                old_path: None,
            }
        })
        .filter(|f| !f.path.ends_with('/'))
        .collect()
}

/// Parses `git status --porcelain` output into staged/unstaged/untracked
/// buckets. Uses the two-character XY format: X = index status, Y = working-tree
/// status.
pub fn parse_status_buckets(output: &str) -> StatusBuckets {
    let mut staged: Vec<String> = Vec::new();
    let mut unstaged: Vec<String> = Vec::new();
    let mut untracked: Vec<String> = Vec::new();

    for line in output.split('\n').filter(|l| !l.is_empty()) {
        let index_status = line.chars().next().unwrap_or(' ');
        let working_status = line.chars().nth(1).unwrap_or(' ');
        let filename: String = line.chars().skip(3).collect();

        if index_status == '?' && working_status == '?' {
            untracked.push(filename);
            continue;
        }
        if index_status != ' ' {
            staged.push(filename.clone());
        }
        if working_status != ' ' {
            unstaged.push(filename);
        }
    }

    StatusBuckets {
        staged,
        unstaged,
        untracked,
    }
}

/// Parses `git branch --no-color [-a]` output into the current branch and the
/// full list of branch names. Remote branches keep their `remotes/<remote>/...`
/// prefix; the `remotes/origin/HEAD -> origin/main` pointer keeps its name so
/// callers can filter it. Detached HEAD lines resolve to the ref they point at.
pub fn parse_branch_list(output: &str) -> BranchList {
    let mut all: Vec<String> = Vec::new();
    let mut current = String::new();
    for line in output.split('\n') {
        if line.trim().is_empty() {
            continue;
        }
        let is_current = line.starts_with("* ");
        let rest = strip_branch_marker(line);
        let name = match parse_detached(rest) {
            Some(sha) => sha,
            None => rest.split_whitespace().next().unwrap_or("").to_string(),
        };
        if name.is_empty() {
            continue;
        }
        all.push(name.clone());
        if is_current {
            current = name;
        }
    }
    BranchList { current, all }
}

/// Mirrors `line.replace(/^[*+]?\s+/, '')`: strip an optional leading `*`/`+`
/// marker followed by one-or-more whitespace. No match (e.g. marker with no
/// trailing whitespace) leaves the line untouched.
fn strip_branch_marker(line: &str) -> &str {
    let marker_len = match line.chars().next() {
        Some(c) if c == '*' || c == '+' => c.len_utf8(),
        _ => 0,
    };
    let after_marker = &line[marker_len..];
    let ws_len: usize = after_marker
        .chars()
        .take_while(|c| c.is_whitespace())
        .map(|c| c.len_utf8())
        .sum();
    if ws_len == 0 {
        line
    } else {
        &line[marker_len + ws_len..]
    }
}

/// Mirrors `/^\((?:HEAD )?detached (?:from|at) (\S+)\)/`: resolve a detached-HEAD
/// line to the ref it points at.
fn parse_detached(rest: &str) -> Option<String> {
    let inner = rest.strip_prefix('(')?;
    let inner = inner.strip_prefix("HEAD ").unwrap_or(inner);
    let after = inner
        .strip_prefix("detached from ")
        .or_else(|| inner.strip_prefix("detached at "))?;
    let run: String = after.chars().take_while(|c| !c.is_whitespace()).collect();
    let sha = run.strip_suffix(')')?;
    if sha.is_empty() {
        return None;
    }
    Some(sha.to_string())
}

/// Branch names from `git remote` (one per line).
pub fn parse_remotes(output: &str) -> Vec<String> {
    output
        .split('\n')
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect()
}

/// A named remote and its URL, as reported by `git remote -v`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteUrl {
    pub name: String,
    pub url: String,
}

/// Parses `git remote -v` output (`<name>\t<url> (fetch|push)` per line) into
/// one entry per distinct name/URL pair, in first-seen order. Each remote
/// normally prints its URL twice (fetch and push); this dedupes that pair
/// rather than exposing direction.
pub fn parse_remote_urls(output: &str) -> Vec<RemoteUrl> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for line in output.split('\n') {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Some((name, rest)) = line.split_once('\t') else {
            continue;
        };
        let url = rest.trim().rsplit_once(' ').map_or(rest.trim(), |(u, _)| u);
        if name.is_empty() || url.is_empty() {
            continue;
        }
        let key = (name.to_string(), url.to_string());
        if seen.insert(key) {
            result.push(RemoteUrl {
                name: name.to_string(),
                url: url.to_string(),
            });
        }
    }
    result
}

/// An `owner/repo` pair derived from a GitHub remote URL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitHubRepoRef {
    pub owner: String,
    pub repo: String,
}

/// Extracts `owner/repo` from a GitHub remote URL, accepting the four shapes
/// `git remote -v` can print: `https://github.com/o/r[.git]`,
/// `git@github.com:o/r.git` (scp-like syntax), and `ssh://git@github.com/o/r.git`.
/// Rejects any other host, a path with fewer or more than two segments, a
/// foreign-transport prefix (`ext::`, `file::`/`file://`), and a segment
/// containing anything outside `[A-Za-z0-9._-]`.
pub fn github_repo_from_url(url: &str) -> Option<GitHubRepoRef> {
    let url = url.trim();
    if url.starts_with("ext::") || url.starts_with("file::") || url.starts_with("file://") {
        return None;
    }
    let path = url
        .strip_prefix("git@github.com:")
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))
        .or_else(|| url.strip_prefix("https://github.com/"))
        .or_else(|| url.strip_prefix("http://github.com/"))?;
    let path = path.strip_suffix(".git").unwrap_or(path);
    let path = path.trim_end_matches('/');
    let mut segments = path.split('/');
    let owner = segments.next()?;
    let repo = segments.next()?;
    if segments.next().is_some() {
        return None;
    }
    if !is_valid_repo_segment(owner) || !is_valid_repo_segment(repo) {
        return None;
    }
    Some(GitHubRepoRef {
        owner: owner.to_string(),
        repo: repo.to_string(),
    })
}

/// Rejects anything outside `[A-Za-z0-9._-]` — the shape GitHub itself
/// enforces for an owner or repo name. Any caller that accepts an
/// `owner`/`repo` pair from outside this module (route input, stored
/// config, …) must run it through here before the value reaches a URL or a
/// process argument.
pub fn is_valid_repo_segment(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

/// Extracts the commit hash from `git commit` output, whose first line is
/// `[<branch> (root-commit)? <hash>] <subject>`. Returns '' when absent.
/// `-c core.abbrev=40` makes the hash the full sha.
pub fn parse_commit_hash(output: &str) -> String {
    for line in output.split('\n') {
        if let Some(hash) = match_commit_line(line) {
            return hash;
        }
    }
    String::new()
}

// Mirrors `/^\[[^\s]+(?: \([^)]+\))? ([^\]]+)\]/`.
fn match_commit_line(line: &str) -> Option<String> {
    let s = line.strip_prefix('[')?;
    // [^\s]+ branch
    let branch_end = s.find(char::is_whitespace)?;
    if branch_end == 0 {
        return None;
    }
    let mut rest = &s[branch_end..];
    // Optional " (root-commit)" group: ` \([^)]+\)`.
    if let Some(after_group) = match_root_group(rest) {
        rest = after_group;
    }
    // Literal ' ' before the capture.
    let rest = rest.strip_prefix(' ')?;
    // ([^\]]+) up to ']'.
    let close = rest.find(']')?;
    if close == 0 {
        return None;
    }
    Some(rest[..close].trim().to_string())
}

fn match_root_group(rest: &str) -> Option<&str> {
    let r = rest.strip_prefix(' ')?;
    let r = r.strip_prefix('(')?;
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
    for line in output.split('\n') {
        if let Some(summary) = match_diff_stat(line) {
            return summary;
        }
    }
    DiffStatSummary {
        changes: 0,
        insertions: 0,
        deletions: 0,
    }
}

// Mirrors `/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/`.
fn match_diff_stat(line: &str) -> Option<DiffStatSummary> {
    let bytes = line.as_bytes();
    for start in 0..line.len() {
        if !bytes[start].is_ascii_digit() {
            continue;
        }
        if let Some(summary) = try_diff_stat_at(&line[start..]) {
            return Some(summary);
        }
    }
    None
}

fn try_diff_stat_at(rest: &str) -> Option<DiffStatSummary> {
    let (changes, rest) = take_digits(rest)?;
    let rest = rest.strip_prefix(" file")?;
    let rest = rest.strip_prefix('s').unwrap_or(rest);
    let after_changed = rest.strip_prefix(" changed")?;

    let mut insertions = 0i64;
    let mut deletions = 0i64;
    let mut cur = after_changed;
    if let Some((n, r)) = try_stat_clause(cur, "insertion", "(+)") {
        insertions = n;
        cur = r;
    }
    if let Some((n, _r)) = try_stat_clause(cur, "deletion", "(-)") {
        deletions = n;
    }
    Some(DiffStatSummary {
        changes,
        insertions,
        deletions,
    })
}

// Mirrors `, (\d+) <word>s?<suffix>`.
fn try_stat_clause<'a>(s: &'a str, word: &str, suffix: &str) -> Option<(i64, &'a str)> {
    let r = s.strip_prefix(", ")?;
    let (n, r) = take_digits(r)?;
    let r = r.strip_prefix(' ')?;
    let r = r.strip_prefix(word)?;
    let r = r.strip_prefix('s').unwrap_or(r);
    let r = r.strip_prefix(suffix)?;
    Some((n, r))
}

// `(\d+)` — one-or-more leading ASCII digits; `parseInt(x, 10) || 0`.
fn take_digits(s: &str) -> Option<(i64, &str)> {
    let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    if end == 0 {
        return None;
    }
    let n = s[..end].parse::<i64>().unwrap_or(0);
    Some((n, &s[end..]))
}

/// Count of `Auto-merging <file>` lines git prints during a merge.
pub fn count_auto_merges(output: &str) -> usize {
    output
        .split('\n')
        .filter(|l| l.starts_with("Auto-merging "))
        .count()
}

const CONFLICT_CODES: [&str; 7] = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"];

/// Parses NUL-separated `git status --porcelain -z` output into per-file entries
/// (index/working-dir status chars) plus the conflicted-path list. Renamed and
/// copied entries consume the following NUL-separated old-path token. The
/// conflicted set is git's both-modified/unmerged XY codes.
pub fn parse_status_z(output: &str) -> PorcelainStatus {
    let mut files: Vec<StatusFile> = Vec::new();
    let mut conflicted: Vec<String> = Vec::new();
    let tokens: Vec<&str> = output.split('\0').collect();
    let mut i = 0;
    while i < tokens.len() {
        let entry = tokens[i];
        if entry.is_empty() {
            i += 1;
            continue;
        }
        let index = entry.chars().next().unwrap_or(' ');
        let working = entry.chars().nth(1).unwrap_or(' ');
        let path: String = entry.chars().skip(3).collect();
        let code = format!("{index}{working}");
        // Renamed/copied entries carry the source path in the next NUL token.
        if index == 'R' || index == 'C' {
            i += 1;
        }
        if code == "!!" {
            i += 1;
            continue;
        }
        files.push(StatusFile {
            path: path.clone(),
            index: index.to_string(),
            working_dir: working.to_string(),
        });
        if CONFLICT_CODES.contains(&code.as_str()) {
            conflicted.push(path);
        }
        i += 1;
    }
    PorcelainStatus { conflicted, files }
}

/// `parseInt(s, 10) || 0` — leading-digit parse with a NaN→0 fallback, matching
/// JS. Handles an optional leading `-` and leading whitespace.
pub(crate) fn js_parse_int(s: &str) -> i64 {
    let t = s.trim_start();
    let (neg, t) = match t.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, t),
    };
    let digits: String = t.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return 0;
    }
    let n = digits.parse::<i64>().unwrap_or(0);
    if neg { -n } else { n }
}

#[cfg(test)]
#[path = "git_parse_tests.rs"]
mod tests;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WorktreeEntry {
    pub path: String,
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
mod worktree_tests {
    use super::{WorktreeEntry, parse_worktree_list};

    #[test]
    fn parses_branch_and_detached_records() {
        let output = "worktree /a\nbranch refs/heads/main\n\nworktree /b\ndetached\n\n";
        assert_eq!(
            parse_worktree_list(output),
            vec![
                WorktreeEntry {
                    path: "/a".into(),
                    branch: Some("refs/heads/main".into())
                },
                WorktreeEntry {
                    path: "/b".into(),
                    branch: None
                },
            ]
        );
    }
}
